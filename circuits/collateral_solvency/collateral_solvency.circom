pragma circom 2.1.9;

// Reuse eERC's audited BabyJubJub/ElGamal templates + circomlib comparators.
include "../../contracts/lib/EncryptedERC/circom/components.circom";
include "../../contracts/lib/EncryptedERC/circom/circomlib/comparators.circom";

// CollateralSolvency (Circuit 1).
//
// Borrower proves, in zero knowledge, that their encrypted collateral covers the
// haircut-scaled encrypted loan size, WITHOUT revealing either amount:
//   (1) ownerPub == ownerPriv · G
//   (2) Dec(ownerPriv, Ccoll) == coll         (collateral plaintext)
//   (3) Dec(ownerPriv, Cloan) == loan          (loan-size plaintext)
//   (4) coll * 10000 >= loan * h               (h = 12000 bps = 120% haircut)
//
// Both ciphertexts are eERC EGCTs encrypted to the borrower's own key. coll/loan
// are private witnesses the borrower already knows (they own the amounts).
template CollateralSolvency() {
    // ---- public ----
    signal input Ccoll_c1[2];
    signal input Ccoll_c2[2];
    signal input Cloan_c1[2];
    signal input Cloan_c2[2];
    signal input h;            // haircut in bps (12000)
    signal input ownerPub[2];

    // ---- private ----
    signal input ownerPriv;
    signal input coll;
    signal input loan;

    // (1) key binds to the public owner key
    component checkPk = CheckPublicKey();
    checkPk.privKey <== ownerPriv;
    checkPk.pubKey[0] <== ownerPub[0];
    checkPk.pubKey[1] <== ownerPub[1];

    // (2) collateral ciphertext decrypts to `coll`
    component checkColl = CheckValue();
    checkColl.value <== coll;
    checkColl.privKey <== ownerPriv;
    checkColl.valueC1[0] <== Ccoll_c1[0];
    checkColl.valueC1[1] <== Ccoll_c1[1];
    checkColl.valueC2[0] <== Ccoll_c2[0];
    checkColl.valueC2[1] <== Ccoll_c2[1];

    // (3) loan-size ciphertext decrypts to `loan`
    component checkLoan = CheckValue();
    checkLoan.value <== loan;
    checkLoan.privKey <== ownerPriv;
    checkLoan.valueC1[0] <== Cloan_c1[0];
    checkLoan.valueC1[1] <== Cloan_c1[1];
    checkLoan.valueC2[0] <== Cloan_c2[0];
    checkLoan.valueC2[1] <== Cloan_c2[1];

    // (4) coll * 10000 >= loan * h, expressed as NOT(collScaled < loanScaled).
    //     circomlib here ships only LessThan; range-checked to 96 bits.
    signal collScaled;
    signal loanScaled;
    collScaled <== coll * 10000;
    loanScaled <== loan * h;

    component lt = LessThan(96);
    lt.in[0] <== collScaled;
    lt.in[1] <== loanScaled;
    lt.out === 0; // collScaled is NOT < loanScaled  =>  collScaled >= loanScaled
}

component main { public [ Ccoll_c1, Ccoll_c2, Cloan_c1, Cloan_c2, h, ownerPub ] } = CollateralSolvency();

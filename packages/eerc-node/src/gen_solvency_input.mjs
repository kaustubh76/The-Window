// Generate a valid witness for the CollateralSolvency (Circuit 1) proof.
// Borrower holds encrypted collateral `coll` and loan size `loan`, both encrypted
// to their OWN key, and proves coll*10000 >= loan*12000 (120% haircut).
import { writeFileSync } from "node:fs";
import { genUser, encryptMessage } from "./eerc.mjs";

const OUT = process.argv[2] || "../../circuits/build/solvency_input.json";

const coll = 6000n; // collateral
const loan = 5000n; // loan size  -> 6000*10000 = 60,000,000 >= 5000*12000 = 60,000,000 (exactly 120%)
const h = 12000n;

const user = genUser();
const { cipher: cColl } = encryptMessage(user.publicKey, coll);
const { cipher: cLoan } = encryptMessage(user.publicKey, loan);

const dec = (p) => [p[0].toString(), p[1].toString()];
const input = {
  Ccoll_c1: dec(cColl[0]),
  Ccoll_c2: dec(cColl[1]),
  Cloan_c1: dec(cLoan[0]),
  Cloan_c2: dec(cLoan[1]),
  h: h.toString(),
  ownerPub: [user.publicKey[0].toString(), user.publicKey[1].toString()],
  ownerPriv: user.formattedPrivateKey.toString(),
  coll: coll.toString(),
  loan: loan.toString(),
};
writeFileSync(OUT, JSON.stringify(input, null, 2));
console.log("OK: wrote", OUT, "(coll", coll.toString(), ">= 1.2 *", loan.toString() + ")");

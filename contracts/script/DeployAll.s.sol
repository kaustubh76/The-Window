// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {SimpleERC20} from "@eerc/tokens/SimpleERC20.sol";
import {Registrar} from "@eerc/Registrar.sol";
import {EncryptedERC} from "@eerc/EncryptedERC.sol";
import {CreateEncryptedERCParams} from "@eerc/types/Types.sol";

import {RegistrationVerifierGen} from "../src/verifiers/eerc/RegistrationVerifierGen.sol";
import {MintVerifierGen} from "../src/verifiers/eerc/MintVerifierGen.sol";
import {TransferVerifierGen} from "../src/verifiers/eerc/TransferVerifierGen.sol";
import {WithdrawVerifierGen} from "../src/verifiers/eerc/WithdrawVerifierGen.sol";
import {BurnVerifierGen} from "../src/verifiers/eerc/BurnVerifierGen.sol";

import {MemberRegistry} from "../src/MemberRegistry.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {MONIAOracle} from "../src/MONIAOracle.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {LoanBook} from "../src/LoanBook.sol";
import {MockVerifier} from "../src/verifiers/MockVerifier.sol";
import {DepthPoCDArrayVerifier} from "../src/verifiers/DepthPoCDArrayVerifier.sol";
import {PoCDVerifierAdapter} from "../src/verifiers/PoCDVerifierAdapter.sol";
import {CollateralSolvencyVerifier} from "../src/verifiers/CollateralSolvencyVerifier.sol";
import {SolvencyVerifierAdapter} from "../src/verifiers/SolvencyVerifierAdapter.sol";

/// @notice Deploys + wires the FULL WINDOW stack (eERC converter + 5 WINDOW contracts).
///         DEMO/PROD via env. Real Groth16 verifiers when USE_REAL_VERIFIERS=1, else
///         MockVerifier (fast local demo). EOA registration + auditor binding happen in
///         packages/eerc-node/src/register_all.mjs (registration needs client-side proofs).
contract DeployAll is Script {
    function run() external {
        uint256 pk = vm.envUint("ADMIN_PK");
        address admin = vm.addr(pk);
        address keeper = vm.envOr("KEEPER_ADDR", admin);
        address operator = vm.envOr("VAULT_OPERATOR_ADDR", admin);
        uint256 epochLen = vm.envOr("EPOCH_LEN", uint256(60)); // DEMO 60s / PROD 3600
        uint256 tenorBlocks = vm.envOr("TENOR_BLOCKS", uint256(150)); // DEMO ~5min / PROD ~10800
        uint256 auditorPubX = vm.envOr("AUDITOR_PUB_X", uint256(0));
        uint256 auditorPubY = vm.envOr("AUDITOR_PUB_Y", uint256(0));
        bool real = vm.envOr("USE_REAL_VERIFIERS", uint256(0)) == 1;

        vm.startBroadcast(pk);

        // ---- eERC converter stack ----
        SimpleERC20 usdc = new SimpleERC20("Test USDC", "tUSDC", 6);
        address regV = address(new RegistrationVerifierGen());
        address mintV = address(new MintVerifierGen());
        address transferV = address(new TransferVerifierGen());
        address withdrawV = address(new WithdrawVerifierGen());
        address burnV = address(new BurnVerifierGen());
        Registrar registrar = new Registrar(regV);
        EncryptedERC eerc = new EncryptedERC(
            CreateEncryptedERCParams({
                registrar: address(registrar),
                isConverter: true,
                name: "",
                symbol: "",
                decimals: 6,
                mintVerifier: mintV,
                withdrawVerifier: withdrawV,
                transferVerifier: transferV,
                burnVerifier: burnV
            })
        );

        // ---- WINDOW contracts ----
        MemberRegistry registry = new MemberRegistry(admin);
        AuctionHouse auction = new AuctionHouse(address(registry), epochLen, keeper);

        address pocdVerifier;
        address solvencyVerifier;
        if (real) {
            // Chunked PoCD verifier (102 signals, ~18KB) fits EIP-170 and deploys inline.
            pocdVerifier = address(new PoCDVerifierAdapter(address(new DepthPoCDArrayVerifier())));
            solvencyVerifier = address(new SolvencyVerifierAdapter(address(new CollateralSolvencyVerifier())));
        } else {
            pocdVerifier = address(new MockVerifier());
            solvencyVerifier = address(new MockVerifier());
        }

        MONIAOracle oracle = new MONIAOracle(address(auction), pocdVerifier, admin, auditorPubX, auditorPubY);
        CollateralVault vault = new CollateralVault(address(registry), solvencyVerifier, operator);
        LoanBook book = new LoanBook(address(registry), address(oracle), address(vault), admin, tenorBlocks);

        // ---- one-time wiring ----
        auction.setOracle(address(oracle));
        vault.setLoanBook(address(book));

        vm.stopBroadcast();

        console2.log("EncryptedERC :", address(eerc));
        console2.log("AuctionHouse :", address(auction));
        console2.log("MONIAOracle  :", address(oracle));
        console2.log("real verifiers:", real);

        string memory j = string.concat(
            '{\n  "TESTUSDC_ADDR": "', vm.toString(address(usdc)),
            '",\n  "EERC_ADDR": "', vm.toString(address(eerc)),
            '",\n  "REGISTRAR_ADDR": "', vm.toString(address(registrar)),
            '",\n  "MEMBER_REGISTRY_ADDR": "', vm.toString(address(registry)),
            '",\n  "AUCTION_HOUSE_ADDR": "', vm.toString(address(auction)),
            '",\n  "MONIA_ORACLE_ADDR": "', vm.toString(address(oracle)),
            '",\n  "COLLATERAL_VAULT_ADDR": "', vm.toString(address(vault)),
            '",\n  "LOAN_BOOK_ADDR": "', vm.toString(address(book)),
            '",\n  "ADMIN_ADDR": "', vm.toString(admin),
            '",\n  "KEEPER_ADDR": "', vm.toString(keeper),
            '",\n  "VAULT_OPERATOR_ADDR": "', vm.toString(operator),
            '"\n}\n'
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), j);
    }
}

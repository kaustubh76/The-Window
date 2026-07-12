// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {SimpleERC20} from "@eerc/tokens/SimpleERC20.sol";
import {Registrar} from "@eerc/Registrar.sol";
import {EncryptedERC} from "@eerc/EncryptedERC.sol";
import {CreateEncryptedERCParams} from "@eerc/types/Types.sol";

// Verifiers exported from the SHIPPED zkeys (the repo's committed verifier.sol
// files do not match the shipped circuit_final.zkey — see spike/NOTES.md).
import {RegistrationVerifierGen} from "../src/verifiers/eerc/RegistrationVerifierGen.sol";
import {MintVerifierGen} from "../src/verifiers/eerc/MintVerifierGen.sol";
import {TransferVerifierGen} from "../src/verifiers/eerc/TransferVerifierGen.sol";
import {WithdrawVerifierGen} from "../src/verifiers/eerc/WithdrawVerifierGen.sol";
import {BurnVerifierGen} from "../src/verifiers/eerc/BurnVerifierGen.sol";

/// @notice Deploys the full eERC converter stack + a TestUSDC faucet token.
///         Writes addresses to contracts/deployments/<chainid>.json.
/// @dev Run locally:  forge script script/DeployEERC.s.sol --rpc-url local --broadcast
contract DeployEERC is Script {
    function run() external {
        uint256 pk = vm.envOr("ADMIN_PK", uint256(0));
        if (pk == 0) {
            // throwaway local-only fallback (NOT a real key; set ADMIN_PK for any real run)
            pk = 0xac0976bf9e1bb63aa4d90da1f2c4dd5c9d8b9c8f8f0b7f3f9b0e9a3f7c1a2b3c;
        }
        vm.startBroadcast(pk);

        // 1. TestUSDC — 6 decimals, public faucet mint()
        SimpleERC20 usdc = new SimpleERC20("Test USDC", "tUSDC", 6);

        // 2. eERC circuit verifiers
        address regV = address(new RegistrationVerifierGen());
        address mintV = address(new MintVerifierGen());
        address transferV = address(new TransferVerifierGen());
        address withdrawV = address(new WithdrawVerifierGen());
        address burnV = address(new BurnVerifierGen());

        // 3. Registrar
        Registrar registrar = new Registrar(regV);

        // 4. EncryptedERC — converter mode, decimals 6 (matches TestUSDC)
        CreateEncryptedERCParams memory params = CreateEncryptedERCParams({
            registrar: address(registrar),
            isConverter: true,
            name: "",
            symbol: "",
            decimals: 6,
            mintVerifier: mintV,
            withdrawVerifier: withdrawV,
            transferVerifier: transferV,
            burnVerifier: burnV
        });
        EncryptedERC eerc = new EncryptedERC(params);

        vm.stopBroadcast();

        console2.log("TestUSDC      :", address(usdc));
        console2.log("Registrar     :", address(registrar));
        console2.log("EncryptedERC  :", address(eerc));

        string memory json = string.concat(
            '{\n  "TESTUSDC_ADDR": "', vm.toString(address(usdc)),
            '",\n  "REGISTRAR_ADDR": "', vm.toString(address(registrar)),
            '",\n  "EERC_ADDR": "', vm.toString(address(eerc)),
            '",\n  "REGISTRATION_VERIFIER": "', vm.toString(regV),
            '"\n}\n'
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemberGated} from "./MemberGated.sol";
import {IPoCDVerifier} from "./interfaces/IPoCDVerifier.sol";
import {EGCT} from "@eerc/types/Types.sol";

/// @title CollateralVault — encrypted, cash-secured collateral for THE WINDOW.
/// @notice A borrower proves in ZK that Dec(collateral) >= h·Dec(loanSize) (Circuit 1)
///         before their encrypted collateral is escrowed. Because a Solidity
///         contract cannot hold a BabyJubJub key or generate proofs, custody sits
///         in a registered `vaultOperator` EOA; this contract holds the AUTHORITY
///         and records, and movement is event-driven (operator executes eERC
///         transfers, then confirms). Disclosed honestly in METHODOLOGY.md.
contract CollateralVault is MemberGated {
    uint256 public constant HAIRCUT_BPS = 12000; // 120%

    enum LockState {
        None,
        Requested,
        Locked,
        Released,
        Seized
    }

    struct Lock {
        address borrower;
        LockState state;
        bytes32 collateralRef;
    }

    IPoCDVerifier public immutable solvencyVerifier;
    address public immutable vaultOperator;
    address public loanBook;

    mapping(uint256 => Lock) public locks;
    uint256 public activeLockCount;

    event LockRequested(uint256 indexed loanId, address indexed borrower);
    event Locked(uint256 indexed loanId, bytes32 collateralRef);
    event ReleaseOrdered(uint256 indexed loanId, address indexed to);
    event SeizeOrdered(uint256 indexed loanId, address indexed lender);
    event Released(uint256 indexed loanId);
    event Seized(uint256 indexed loanId);

    error NotOperator();
    error NotLoanBook();
    error AlreadySet();
    error BadSolvencyProof();
    error BadState();

    modifier onlyOperator() {
        if (msg.sender != vaultOperator) revert NotOperator();
        _;
    }

    modifier onlyLoanBook() {
        if (msg.sender != loanBook) revert NotLoanBook();
        _;
    }

    constructor(address registry_, address solvencyVerifier_, address vaultOperator_) MemberGated(registry_) {
        solvencyVerifier = IPoCDVerifier(solvencyVerifier_);
        vaultOperator = vaultOperator_;
    }

    function setLoanBook(address loanBook_) external {
        if (loanBook != address(0)) revert AlreadySet();
        loanBook = loanBook_;
    }

    /// @notice Borrower proves solvency; operator then escrows the collateral.
    /// @param ownerPub borrower's registered BabyJubJub public key (x,y)
    function lockCollateral(
        uint256 loanId,
        EGCT calldata cCollateral,
        EGCT calldata cLoanSize,
        uint256[2] calldata ownerPub,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external onlyMember {
        if (locks[loanId].state != LockState.None) revert BadState();

        uint256[] memory pub = new uint256[](11);
        pub[0] = cCollateral.c1.x;
        pub[1] = cCollateral.c1.y;
        pub[2] = cCollateral.c2.x;
        pub[3] = cCollateral.c2.y;
        pub[4] = cLoanSize.c1.x;
        pub[5] = cLoanSize.c1.y;
        pub[6] = cLoanSize.c2.x;
        pub[7] = cLoanSize.c2.y;
        pub[8] = HAIRCUT_BPS;
        pub[9] = ownerPub[0];
        pub[10] = ownerPub[1];
        if (!solvencyVerifier.verifyProof(a, b, c, pub)) revert BadSolvencyProof();

        locks[loanId] = Lock({borrower: msg.sender, state: LockState.Requested, collateralRef: 0});
        emit LockRequested(loanId, msg.sender);
    }

    /// @notice Operator confirms the encrypted collateral has been escrowed.
    function confirmLock(uint256 loanId, bytes32 collateralRef) external onlyOperator {
        Lock storage l = locks[loanId];
        if (l.state != LockState.Requested) revert BadState();
        l.state = LockState.Locked;
        l.collateralRef = collateralRef;
        unchecked {
            ++activeLockCount;
        }
        emit Locked(loanId, collateralRef);
    }

    function isLocked(uint256 loanId) external view returns (bool) {
        return locks[loanId].state == LockState.Locked;
    }

    // ----- LoanBook-driven terminal transitions -----

    function release(uint256 loanId) external onlyLoanBook {
        Lock storage l = locks[loanId];
        if (l.state != LockState.Locked) revert BadState();
        l.state = LockState.Released;
        unchecked {
            --activeLockCount;
        }
        emit ReleaseOrdered(loanId, l.borrower);
        emit Released(loanId);
    }

    function seizeTo(uint256 loanId, address lender) external onlyLoanBook {
        Lock storage l = locks[loanId];
        if (l.state != LockState.Locked) revert BadState();
        l.state = LockState.Seized;
        unchecked {
            --activeLockCount;
        }
        emit SeizeOrdered(loanId, lender);
        emit Seized(loanId);
    }
}

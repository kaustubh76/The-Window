// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemberGated} from "./MemberGated.sol";
import {MONIAOracle} from "./MONIAOracle.sol";
import {CollateralVault} from "./CollateralVault.sol";
import {EGCT} from "@eerc/types/Types.sol";

/// @title LoanBook — overnight loan lifecycle for THE WINDOW.
/// @notice The admin posts matches at the printed clearing rate r*; each loan is
///         collateralized (Vault), funded (eERC transfer, auditor-attested), then
///         repaid (release collateral) or, past its deadline block, seized. The
///         contract enforces LIFECYCLE finality (no repay-after-seize, no double
///         fund, deadline safety); transfer magnitudes are auditor-attested since
///         eERC transfer events carry no plaintext amount (see METHODOLOGY.md).
contract LoanBook is MemberGated {
    enum LoanState {
        None,
        Pending,
        Active,
        Repaid,
        Defaulted
    }

    struct Loan {
        address lender;
        address borrower;
        uint64 epoch;
        uint16 rateTick;
        EGCT cSize;
        uint256 deadlineBlock;
        LoanState state;
    }

    struct Match {
        address lender;
        address borrower;
        uint16 rateTick;
        EGCT cSize;
    }

    MONIAOracle public immutable oracle;
    CollateralVault public immutable vault;
    address public immutable admin;
    uint256 public immutable tenorBlocks;

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;
    uint256 public activeLoanCount;

    event LoanCreated(
        uint256 indexed loanId, address indexed lender, address indexed borrower, uint64 epoch, uint16 rateTick, uint256 deadlineBlock
    );
    event Funded(uint256 indexed loanId);
    event Repaid(uint256 indexed loanId);
    event Seized(uint256 indexed loanId);

    error NotAdmin();
    error EpochNotPrinted();
    error BadRate();
    error BadState();
    error CollateralNotLocked();
    error DeadlineNotReached();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address registry_, address oracle_, address vault_, address admin_, uint256 tenorBlocks_)
        MemberGated(registry_)
    {
        oracle = MONIAOracle(oracle_);
        vault = CollateralVault(vault_);
        admin = admin_;
        tenorBlocks = tenorBlocks_;
    }

    /// @notice Admin posts the match set for a printed epoch. Every match must
    ///         clear at the epoch's printed r* (enforces invariant 4).
    function postMatches(uint64 epoch, Match[] calldata ms) external onlyAdmin {
        (uint16 rStar, bool exists) = oracle.rateAt(epoch);
        if (!exists) revert EpochNotPrinted();
        for (uint256 i = 0; i < ms.length; i++) {
            if (ms[i].rateTick != rStar) revert BadRate();
            uint256 id = nextLoanId++;
            loans[id] = Loan({
                lender: ms[i].lender,
                borrower: ms[i].borrower,
                epoch: epoch,
                rateTick: ms[i].rateTick,
                cSize: ms[i].cSize,
                deadlineBlock: block.number + tenorBlocks,
                state: LoanState.Pending
            });
            emit LoanCreated(id, ms[i].lender, ms[i].borrower, epoch, ms[i].rateTick, block.number + tenorBlocks);
        }
    }

    /// @notice Admin confirms the lender funded the borrower (auditor-attested).
    ///         Requires the borrower's collateral to be locked first.
    function confirmFunding(uint256 loanId, bytes32 /*transferRef*/ ) external onlyAdmin {
        Loan storage l = loans[loanId];
        if (l.state != LoanState.Pending) revert BadState();
        if (!vault.isLocked(loanId)) revert CollateralNotLocked();
        l.state = LoanState.Active;
        unchecked {
            ++activeLoanCount;
        }
        emit Funded(loanId);
    }

    /// @notice Admin confirms repayment (auditor-attested) → release collateral.
    function repay(uint256 loanId, bytes32 /*transferRef*/ ) external onlyAdmin {
        Loan storage l = loans[loanId];
        if (l.state != LoanState.Active) revert BadState();
        l.state = LoanState.Repaid;
        unchecked {
            --activeLoanCount;
        }
        vault.release(loanId);
        emit Repaid(loanId);
    }

    /// @notice Anyone may seize a defaulted loan past its deadline block.
    function seize(uint256 loanId) external {
        Loan storage l = loans[loanId];
        if (l.state != LoanState.Active) revert BadState();
        if (block.number <= l.deadlineBlock) revert DeadlineNotReached();
        l.state = LoanState.Defaulted;
        unchecked {
            --activeLoanCount;
        }
        vault.seizeTo(loanId, l.lender);
        emit Seized(loanId);
    }

    function loanState(uint256 loanId) external view returns (LoanState) {
        return loans[loanId].state;
    }
}

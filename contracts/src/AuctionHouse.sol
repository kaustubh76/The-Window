// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemberGated} from "./MemberGated.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

/// @title AuctionHouse — hourly uniform-price auction over ENCRYPTED bid sizes.
/// @notice Rate ticks are public; sizes are eERC ElGamal ciphertexts (EGCT).
///         Per (epoch, side, tick) the contract homomorphically accumulates
///         `Σ Enc(size)` via BabyJubJub point addition — validated in spike/GATE.md
///         (~13k gas/add). The admin decrypts the per-tick sums under the auditor
///         key; MONIAOracle proves that decryption (PoCD) before printing M-ONIA.
contract AuctionHouse is MemberGated {
    // 37 ticks: index i -> rate (100 + 25*i) bps, i.e. 1.00%..10.00% at 25bps.
    uint16 public constant TICKS = 37;
    uint8 public constant ASK = 0; // lenders (min acceptable rate)
    uint8 public constant BID = 1; // borrowers (max acceptable rate)

    enum Status {
        None,
        Open,
        Closed,
        Printed
    }

    struct Acc {
        Point c1;
        Point c2;
        bool init;
    }

    uint256 public immutable epochLength; // seconds (DEMO=60, PROD=3600)
    address public keeper;
    address public oracle;

    uint64 public currentEpoch;
    mapping(uint64 => Status) public epochStatus;
    mapping(uint64 => uint256) public epochStart;

    // epoch => side => tick => accumulated EGCT
    mapping(uint64 => mapping(uint8 => mapping(uint16 => Acc))) internal acc;
    // epoch => side => tick => number of bids accumulated (pro-rata / gas metric)
    mapping(uint64 => mapping(uint8 => mapping(uint16 => uint32))) public bidCount;
    // one bid per member per side per tick per epoch
    mapping(uint64 => mapping(uint8 => mapping(uint16 => mapping(address => bool)))) public filled;

    event EpochOpened(uint64 indexed epoch, uint256 startTs);
    event EpochClosed(uint64 indexed epoch, uint256 closeTs);
    event AskSubmitted(uint64 indexed epoch, address indexed who, uint16 tick, bytes fundsRef);
    event BidSubmitted(uint64 indexed epoch, address indexed who, uint16 tick);
    event EpochPrinted(uint64 indexed epoch);

    error NotKeeper();
    error NotOracle();
    error AlreadySet();
    error BadTick();
    error NotOpen();
    error AlreadyBidHere();
    error WindowNotElapsed();
    error EpochNotClosed();
    error PrevEpochStillOpen();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(address registry_, uint256 epochLength_, address keeper_) MemberGated(registry_) {
        epochLength = epochLength_;
        keeper = keeper_;
    }

    /// @notice One-time wiring of the MONIAOracle (self-locking).
    function setOracle(address oracle_) external {
        if (oracle != address(0)) revert AlreadySet();
        oracle = oracle_;
    }

    // ----- epoch lifecycle (keeper) -----

    function openEpoch() external onlyKeeper returns (uint64) {
        if (currentEpoch != 0 && epochStatus[currentEpoch] == Status.Open) revert PrevEpochStillOpen();
        uint64 e = ++currentEpoch;
        epochStatus[e] = Status.Open;
        epochStart[e] = block.timestamp;
        emit EpochOpened(e, block.timestamp);
        return e;
    }

    function closeEpoch() external onlyKeeper {
        uint64 e = currentEpoch;
        if (epochStatus[e] != Status.Open) revert NotOpen();
        if (block.timestamp < epochStart[e] + epochLength) revert WindowNotElapsed();
        epochStatus[e] = Status.Closed;
        emit EpochClosed(e, block.timestamp);
    }

    // ----- bidding (members) -----

    function submitAsk(uint16 tick, EGCT calldata cSize, bytes calldata fundsRef) external onlyMember {
        _accumulate(ASK, tick, cSize);
        emit AskSubmitted(currentEpoch, msg.sender, tick, fundsRef);
    }

    function submitBid(uint16 tick, EGCT calldata cSize) external onlyMember {
        _accumulate(BID, tick, cSize);
        emit BidSubmitted(currentEpoch, msg.sender, tick);
    }

    function _accumulate(uint8 side, uint16 tick, EGCT calldata c) internal {
        if (tick >= TICKS) revert BadTick();
        uint64 e = currentEpoch;
        if (epochStatus[e] != Status.Open) revert NotOpen();
        if (filled[e][side][tick][msg.sender]) revert AlreadyBidHere();
        filled[e][side][tick][msg.sender] = true;

        Acc storage s = acc[e][side][tick];
        if (!s.init) {
            s.c1 = c.c1;
            s.c2 = c.c2;
            s.init = true;
        } else {
            s.c1 = BabyJubJub._add(s.c1, c.c1);
            s.c2 = BabyJubJub._add(s.c2, c.c2);
        }
        unchecked {
            ++bidCount[e][side][tick];
        }
    }

    // ----- reads (admin + oracle) -----

    function getAggregate(uint64 e, uint8 side, uint16 tick)
        external
        view
        returns (EGCT memory egct, uint32 count, bool init)
    {
        Acc storage s = acc[e][side][tick];
        if (!s.init) {
            // Empty tick: return the BabyJubJub identity point (0,1) for both c1,c2.
            // This is a valid on-curve ciphertext of 0 (Dec = c2 - priv·c1 = identity),
            // so the DepthCurve PoCD circuit's on-curve checks pass for padded ticks.
            Point memory id = Point({x: 0, y: 1});
            return (EGCT({c1: id, c2: id}), 0, false);
        }
        return (EGCT({c1: s.c1, c2: s.c2}), bidCount[e][side][tick], s.init);
    }

    /// @notice Called by MONIAOracle after a successful print.
    function markPrinted(uint64 e) external {
        if (msg.sender != oracle) revert NotOracle();
        if (epochStatus[e] != Status.Closed) revert EpochNotClosed();
        epochStatus[e] = Status.Printed;
        emit EpochPrinted(e);
    }
}

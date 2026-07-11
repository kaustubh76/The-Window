// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuctionHouse} from "./AuctionHouse.sol";
import {IPoCDVerifier} from "./interfaces/IPoCDVerifier.sol";
import {EGCT} from "@eerc/types/Types.sol";

/// @title MONIAOracle — prints M-ONIA, the Machine Overnight Index Average.
/// @notice Verifies a proof of correct decryption (PoCD) that the published
///         per-tick depth is the true decryption of AuctionHouse's on-chain
///         EGCT accumulators, then computes the uniform clearing rate r* and the
///         matched volume ON-CHAIN from that proven depth. The public input to
///         the verifier is built here from on-chain accumulators, so a valid
///         proof cannot certify admin-invented numbers. This is the SOFR model:
///         confidential inputs, accountable administrator, public benchmark.
contract MONIAOracle {
    uint16 public constant NO_TRADE = type(uint16).max;

    struct DepthPoint {
        uint256 askSum; // decrypted Σ ask sizes at this tick
        uint256 bidSum; // decrypted Σ bid sizes at this tick
    }

    struct Print {
        uint16 rStarTick;
        uint256 aggVolume;
        uint64 printedAt;
        bool exists;
    }

    AuctionHouse public immutable auctionHouse;
    IPoCDVerifier public immutable verifier;
    address public immutable admin;
    uint256 public immutable auditorPubX;
    uint256 public immutable auditorPubY;

    mapping(uint64 => Print) public prints;
    uint64 public lastPrintedEpoch;
    bool public lastPrintStale;

    event RatePrinted(uint64 indexed epoch, uint16 rStarTick, uint256 aggVolume);
    event NoTrade(uint64 indexed epoch);

    error NotAdmin();
    error EpochNotClosed();
    error AlreadyPrinted();
    error BadDepthLength();
    error BadProof();
    error WrongClearingTick();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address auctionHouse_, address verifier_, address admin_, uint256 auditorPubX_, uint256 auditorPubY_) {
        auctionHouse = AuctionHouse(auctionHouse_);
        verifier = IPoCDVerifier(verifier_);
        admin = admin_;
        auditorPubX = auditorPubX_;
        auditorPubY = auditorPubY_;
    }

    /// @notice Post an M-ONIA print for a Closed epoch.
    /// @param epoch      the epoch being priced
    /// @param rStarTick  claimed clearing tick (must equal the on-chain crossing)
    /// @param depth      per-tick decrypted sums, length == TICKS (padded)
    function postPrint(
        uint64 epoch,
        uint16 rStarTick,
        DepthPoint[] calldata depth,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external onlyAdmin {
        if (auctionHouse.epochStatus(epoch) != AuctionHouse.Status.Closed) revert EpochNotClosed();
        if (prints[epoch].exists) revert AlreadyPrinted();
        uint16 ticks = auctionHouse.TICKS();
        if (depth.length != ticks) revert BadDepthLength();

        // 1. Bind the proof to on-chain accumulators + claimed sums + auditor key.
        if (!verifier.verifyProof(a, b, c, _buildPublicSignals(epoch, depth))) revert BadProof();

        // 2. Compute the clearing rate r* ON-CHAIN from the proof-verified depth.
        (uint16 crossing, uint256 matched, bool trade) = _computeClearing(depth);

        if (!trade) {
            if (rStarTick != NO_TRADE) revert WrongClearingTick();
            prints[epoch] = Print({rStarTick: NO_TRADE, aggVolume: 0, printedAt: uint64(block.timestamp), exists: true});
            lastPrintStale = true;
            auctionHouse.markPrinted(epoch);
            emit NoTrade(epoch);
            return;
        }

        if (rStarTick != crossing) revert WrongClearingTick();
        prints[epoch] = Print({rStarTick: crossing, aggVolume: matched, printedAt: uint64(block.timestamp), exists: true});
        lastPrintedEpoch = epoch;
        lastPrintStale = false;
        auctionHouse.markPrinted(epoch);
        emit RatePrinted(epoch, crossing, matched);
    }

    /// @dev Uniform-price crossing. Lenders (asks) accept if r* >= their tick;
    ///      borrowers (bids) accept if r* <= their tick. Cumulative supply at
    ///      tick t = Σ asks with tick <= t; cumulative demand = Σ bids with tick >= t.
    ///      r* = lowest tick where supply >= demand (both positive); matched = min.
    function _computeClearing(DepthPoint[] calldata depth)
        internal
        pure
        returns (uint16 crossing, uint256 matched, bool trade)
    {
        uint256 n = depth.length;
        // suffix demand: totalBid[t] = Σ_{j>=t} bidSum[j]
        uint256 totalBid;
        for (uint256 i = 0; i < n; i++) {
            totalBid += depth[i].bidSum;
        }
        uint256 cumSupply;
        uint256 demandFrom = totalBid; // demand at tick 0 = all bids
        for (uint256 t = 0; t < n; t++) {
            cumSupply += depth[t].askSum;
            // demandFrom currently = Σ bids with tick >= t
            if (cumSupply > 0 && demandFrom > 0 && cumSupply >= demandFrom) {
                return (uint16(t), demandFrom < cumSupply ? demandFrom : cumSupply, true);
            }
            demandFrom -= depth[t].bidSum; // advance to tick t+1
        }
        return (NO_TRADE, 0, false);
    }

    /// @dev Public-signal vector: auditor pubkey, then per tick the accumulator
    ///      (c1.x,c1.y,c2.x,c2.y) for ASK and BID plus the claimed sums. The
    ///      verifier proves each claimed sum decrypts the corresponding accumulator.
    /// @dev Public-signal vector matching the `depth_pocd_array` circuit's
    ///      `public [...]` layout (circom flattens arrays GROUPED, not interleaved):
    ///        auditorPub[2],
    ///        askC1[t].x,askC1[t].y (t=0..36),  askC2[t].x,askC2[t].y,  askSum[t],
    ///        bidC1[t].x,bidC1[t].y,            bidC2[t].x,bidC2[t].y,  bidSum[t]
    ///      Total = 2 + 37*10 = 372. Accumulators are read from AuctionHouse so the
    ///      proof binds to on-chain state.
    function _buildPublicSignals(uint64 epoch, DepthPoint[] calldata depth) internal view returns (uint256[] memory) {
        uint16 ticks = auctionHouse.TICKS();
        uint256[] memory sig = new uint256[](2 + uint256(ticks) * 10);
        sig[0] = auditorPubX;
        sig[1] = auditorPubY;
        uint256 p = 2;
        uint8 ask = auctionHouse.ASK();
        uint8 bid = auctionHouse.BID();
        // askC1 (x,y) per tick, then askC2, then askSum
        for (uint16 t = 0; t < ticks; t++) {
            (EGCT memory a,,) = auctionHouse.getAggregate(epoch, ask, t);
            sig[p++] = a.c1.x;
            sig[p++] = a.c1.y;
        }
        for (uint16 t = 0; t < ticks; t++) {
            (EGCT memory a,,) = auctionHouse.getAggregate(epoch, ask, t);
            sig[p++] = a.c2.x;
            sig[p++] = a.c2.y;
        }
        for (uint16 t = 0; t < ticks; t++) {
            sig[p++] = depth[t].askSum;
        }
        // bidC1, bidC2, bidSum
        for (uint16 t = 0; t < ticks; t++) {
            (EGCT memory b,,) = auctionHouse.getAggregate(epoch, bid, t);
            sig[p++] = b.c1.x;
            sig[p++] = b.c1.y;
        }
        for (uint16 t = 0; t < ticks; t++) {
            (EGCT memory b,,) = auctionHouse.getAggregate(epoch, bid, t);
            sig[p++] = b.c2.x;
            sig[p++] = b.c2.y;
        }
        for (uint16 t = 0; t < ticks; t++) {
            sig[p++] = depth[t].bidSum;
        }
        return sig;
    }

    // ----- views -----
    function latestRate() external view returns (uint16 tick, uint64 epoch, bool stale) {
        return (prints[lastPrintedEpoch].rStarTick, lastPrintedEpoch, lastPrintStale);
    }

    function rateAt(uint64 epoch) external view returns (uint16 tick, bool exists) {
        Print storage pr = prints[epoch];
        return (pr.rStarTick, pr.exists);
    }
}

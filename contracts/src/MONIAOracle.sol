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
    /// @dev The PoCD is verified as CHUNKS proofs of CHUNK_TICKS ticks each so the
    ///      generated Groth16 verifier stays under EIP-170 (the 372-signal monolith
    ///      was 62,708 bytes of deployed code). CHUNKS*CHUNK_TICKS (40) >= TICKS (37);
    ///      virtual ticks 37-39 are padded with the identity point and zero sums on
    ///      both the prover and this contract, so a mismatch fails verification.
    uint16 public constant CHUNK_TICKS = 10;
    uint16 public constant CHUNKS = 4;

    struct DepthPoint {
        uint256 askSum; // decrypted Σ ask sizes at this tick
        uint256 bidSum; // decrypted Σ bid sizes at this tick
    }

    struct Groth16Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
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
    /// @param proofs     CHUNKS Groth16 proofs, proofs[k] covering ticks [k*CHUNK_TICKS, (k+1)*CHUNK_TICKS)
    function postPrint(
        uint64 epoch,
        uint16 rStarTick,
        DepthPoint[] calldata depth,
        Groth16Proof[4] calldata proofs
    ) external onlyAdmin {
        if (auctionHouse.epochStatus(epoch) != AuctionHouse.Status.Closed) revert EpochNotClosed();
        if (prints[epoch].exists) revert AlreadyPrinted();
        uint16 ticks = auctionHouse.TICKS();
        if (depth.length != ticks) revert BadDepthLength();

        // 1. Bind every chunk proof to its slice of on-chain accumulators + claimed sums + auditor key.
        for (uint16 k = 0; k < CHUNKS; k++) {
            if (!verifier.verifyProof(proofs[k].a, proofs[k].b, proofs[k].c, _buildChunkSignals(epoch, depth, k))) {
                revert BadProof();
            }
        }

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

    /// @dev Public-signal vector for chunk k, matching the `depth_pocd_array`
    ///      circuit's `public [...]` layout at N = CHUNK_TICKS (circom flattens
    ///      arrays GROUPED, not interleaved):
    ///        auditorPub[2],
    ///        askC1[t].x,askC1[t].y (t = k*10 .. k*10+9),  askC2[t].x,askC2[t].y,  askSum[t],
    ///        bidC1[t].x,bidC1[t].y,                       bidC2[t].x,bidC2[t].y,  bidSum[t]
    ///      Total = 2 + 10*10 = 102 per chunk. Accumulators are read from
    ///      AuctionHouse so each proof binds to on-chain state. Virtual ticks
    ///      >= TICKS (37..39 in the last chunk) use the identity point (0,1) and
    ///      sum 0 WITHOUT touching AuctionHouse — the prover pads identically.
    function _buildChunkSignals(uint64 epoch, DepthPoint[] calldata depth, uint16 k)
        internal
        view
        returns (uint256[] memory)
    {
        uint16 ticks = auctionHouse.TICKS();
        uint16 lo = k * CHUNK_TICKS;
        uint256[] memory sig = new uint256[](2 + uint256(CHUNK_TICKS) * 10);
        sig[0] = auditorPubX;
        sig[1] = auditorPubY;
        uint256 p = 2;
        uint8 ask = auctionHouse.ASK();
        uint8 bid = auctionHouse.BID();
        // askC1 (x,y) per tick, then askC2, then askSum
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            if (t < ticks) {
                (EGCT memory a,,) = auctionHouse.getAggregate(epoch, ask, t);
                sig[p++] = a.c1.x;
                sig[p++] = a.c1.y;
            } else {
                sig[p++] = 0;
                sig[p++] = 1;
            }
        }
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            if (t < ticks) {
                (EGCT memory a,,) = auctionHouse.getAggregate(epoch, ask, t);
                sig[p++] = a.c2.x;
                sig[p++] = a.c2.y;
            } else {
                sig[p++] = 0;
                sig[p++] = 1;
            }
        }
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            sig[p++] = t < ticks ? depth[t].askSum : 0;
        }
        // bidC1, bidC2, bidSum
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            if (t < ticks) {
                (EGCT memory b,,) = auctionHouse.getAggregate(epoch, bid, t);
                sig[p++] = b.c1.x;
                sig[p++] = b.c1.y;
            } else {
                sig[p++] = 0;
                sig[p++] = 1;
            }
        }
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            if (t < ticks) {
                (EGCT memory b,,) = auctionHouse.getAggregate(epoch, bid, t);
                sig[p++] = b.c2.x;
                sig[p++] = b.c2.y;
            } else {
                sig[p++] = 0;
                sig[p++] = 1;
            }
        }
        for (uint16 i = 0; i < CHUNK_TICKS; i++) {
            uint16 t = lo + i;
            sig[p++] = t < ticks ? depth[t].bidSum : 0;
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

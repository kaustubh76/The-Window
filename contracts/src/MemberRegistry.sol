// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MemberRegistry — vetted agent members of THE WINDOW.
/// @notice Admin-gated allowlist. `onlyMember` is consumed by AuctionHouse,
///         CollateralVault and LoanBook via the MemberGated base. `bjjPubKeyRef`
///         records the member's registered BabyJubJub key (for off-chain services)
///         and becomes the L1 transaction-allowlist source in the D7 stretch.
contract MemberRegistry {
    struct Member {
        bool active;
        uint64 joinedEpoch;
        bytes32 bjjPubKeyRef;
    }

    address public admin;
    mapping(address => Member) public members;
    uint256 public memberCount;

    event MemberAdded(address indexed who, uint64 joinedEpoch, bytes32 bjjPubKeyRef);
    event MemberRemoved(address indexed who);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error AlreadyMember();
    error NotMember();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    function addMember(address who, uint64 joinedEpoch, bytes32 bjjPubKeyRef) external onlyAdmin {
        if (who == address(0)) revert ZeroAddress();
        if (members[who].active) revert AlreadyMember();
        members[who] = Member({active: true, joinedEpoch: joinedEpoch, bjjPubKeyRef: bjjPubKeyRef});
        unchecked {
            ++memberCount;
        }
        emit MemberAdded(who, joinedEpoch, bjjPubKeyRef);
    }

    function removeMember(address who) external onlyAdmin {
        if (!members[who].active) revert NotMember();
        members[who].active = false;
        unchecked {
            --memberCount;
        }
        emit MemberRemoved(who);
    }

    function isMember(address who) external view returns (bool) {
        return members[who].active;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}

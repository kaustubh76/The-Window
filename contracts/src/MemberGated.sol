// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemberRegistry} from "./MemberRegistry.sol";

/// @notice Shared `onlyMember` gate for AuctionHouse / CollateralVault / LoanBook.
abstract contract MemberGated {
    MemberRegistry public immutable registry;

    error NotMember();

    constructor(address registry_) {
        registry = MemberRegistry(registry_);
    }

    modifier onlyMember() {
        if (!registry.isMember(msg.sender)) revert NotMember();
        _;
    }
}

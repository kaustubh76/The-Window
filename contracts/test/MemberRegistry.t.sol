// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";

contract MemberRegistryTest is Test {
    MemberRegistry reg;
    address admin = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public {
        reg = new MemberRegistry(admin);
    }

    function test_AddAndRemove() public {
        vm.prank(admin);
        reg.addMember(alice, 1, bytes32(uint256(0xBEEF)));
        assertTrue(reg.isMember(alice));
        assertEq(reg.memberCount(), 1);

        vm.prank(admin);
        reg.removeMember(alice);
        assertFalse(reg.isMember(alice));
        assertEq(reg.memberCount(), 0);
    }

    function test_OnlyAdminCanAdd() public {
        vm.expectRevert(MemberRegistry.NotAdmin.selector);
        vm.prank(alice);
        reg.addMember(bob, 1, 0);
    }

    function test_NoDoubleAdd() public {
        vm.startPrank(admin);
        reg.addMember(alice, 1, 0);
        vm.expectRevert(MemberRegistry.AlreadyMember.selector);
        reg.addMember(alice, 1, 0);
        vm.stopPrank();
    }

    function test_RemoveNonMemberReverts() public {
        vm.prank(admin);
        vm.expectRevert(MemberRegistry.NotMember.selector);
        reg.removeMember(alice);
    }

    function test_TransferAdmin() public {
        vm.prank(admin);
        reg.transferAdmin(alice);
        assertEq(reg.admin(), alice);
        vm.prank(alice);
        reg.addMember(bob, 1, 0);
        assertTrue(reg.isMember(bob));
    }
}

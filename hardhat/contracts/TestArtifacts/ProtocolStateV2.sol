// SPDX-License-Identifier: MIT
/* Copyright (c) 2023 PowerLoom, Inc. */

pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../ProtocolState.sol";

// Safe way to upgrade the contract is to inherit from previous contract version and add new functionality - this way we can keep the storage layout intact
contract PowerloomProtocolStateV2 is Initializable, OwnableUpgradeable, UUPSUpgradeable, PowerloomProtocolState {
    // TESTING LAYOUTS UPGRADE
    mapping(address => uint256) public newMapping;
    // TESTING LAYOUTS UPGRADE

    // TESTING LOGIC UPGRADE
    function newFunctionality() public pure returns (string memory){
        string memory newFunctionalityString = "This is a new functionality";
        return newFunctionalityString;
    }

    function setNewMapping(address _address, uint256 _value) public {
        newMapping[_address] = _value;
    }
    // TESTING LOGIC UPGRADE
}
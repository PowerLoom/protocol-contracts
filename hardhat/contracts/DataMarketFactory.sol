// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PowerloomDataMarket } from "./DataMarket.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DataMarketFactory
 * @dev Factory contract for creating new PowerloomDataMarket proxy instances
 */
contract DataMarketFactory {
    // Store the implementation address
    address public immutable implementation;

    /**
     * @dev Emitted when a new DataMarket is created
     * @param ownerAddress The address of the owner of the new DataMarket
     * @param epochSize The size of each epoch in the new DataMarket
     * @param sourceChainId The ID of the source chain for the new DataMarket
     * @param sourceChainBlockTime The block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @param protocolState The address of the ProtocolState contract
     * @param dataMarketAddress The address of the newly created DataMarket proxy
     */
    event DataMarketCreated(
        address indexed ownerAddress,
        uint8 epochSize,
        uint256 sourceChainId,
        uint256 sourceChainBlockTime,
        bool useBlockNumberAsEpochId,
        address protocolState,
        address dataMarketAddress    
    );

    /**
     * @dev Constructor for DataMarketFactory
     */
    constructor() {
        // Deploy the implementation contract
        PowerloomDataMarket impl = new PowerloomDataMarket();
        implementation = address(impl);
    }

    /**
     * @dev Creates a new PowerloomDataMarket proxy instance
     * @param ownerAddress The address of the owner of the new DataMarket
     * @param epochSize The size of each epoch in the new DataMarket
     * @param sourceChainId The ID of the source chain for the new DataMarket
     * @param sourceChainBlockTime The block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @param protocolStateAddress The address of the ProtocolState contract
     * @return A new PowerloomDataMarket proxy instance
     */
    function createDataMarket(
        address ownerAddress,
        uint8 epochSize,
        uint256 sourceChainId,
        uint256 sourceChainBlockTime,
        bool useBlockNumberAsEpochId,
        address protocolStateAddress
    )
        external
        returns (PowerloomDataMarket)
    {   
        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            PowerloomDataMarket.initialize.selector,
            ownerAddress,
            epochSize,
            sourceChainId,
            sourceChainBlockTime,
            useBlockNumberAsEpochId,
            protocolStateAddress
        );

        // Deploy proxy with implementation and initialization data
        ERC1967Proxy proxy = new ERC1967Proxy(
            implementation,
            initData
        );

        // Cast proxy address to PowerloomDataMarket
        PowerloomDataMarket dataMarket = PowerloomDataMarket(address(proxy));
        require(address(dataMarket) != address(0), "Failed to create DataMarket");

        // Emit event for the newly created DataMarket
        emit DataMarketCreated(
            ownerAddress, 
            epochSize, 
            sourceChainId, 
            sourceChainBlockTime, 
            useBlockNumberAsEpochId, 
            protocolStateAddress, 
            address(dataMarket)
        );

        return dataMarket;
    }
}

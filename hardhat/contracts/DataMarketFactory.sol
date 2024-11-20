// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PowerloomDataMarket } from "./DataMarket.sol";

/**
 * @title DataMarketFactory
 * @dev Factory contract for creating new PowerloomDataMarket instances
 */
contract DataMarketFactory {
    /**
     * @dev Emitted when a new DataMarket is created
     * @param ownerAddress The address of the owner of the new DataMarket
     * @param epochSize The size of each epoch in the new DataMarket
     * @param sourceChainId The ID of the source chain for the new DataMarket
     * @param sourceChainBlockTime The block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @param protocolState The address of the ProtocolState contract
     * @param dataMarketAddress The address of the newly created DataMarket
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
        // Constructor left empty intentionally
    }

    /**
     * @dev Creates a new PowerloomDataMarket instance
     * @param ownerAddress The address of the owner of the new DataMarket
     * @param epochSize The size of each epoch in the new DataMarket
     * @param sourceChainId The ID of the source chain for the new DataMarket
     * @param sourceChainBlockTime The block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @param protocolStateAddress The address of the ProtocolState contract
     * @return A new PowerloomDataMarket instance
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
        // Create a new PowerloomDataMarket instance
        PowerloomDataMarket dataMarket = new PowerloomDataMarket(address(this));
        require(address(dataMarket) != address(0), "Failed to create DataMarket");

        // Initialize the new DataMarket
        dataMarket.initialize(ownerAddress, epochSize, sourceChainId, sourceChainBlockTime, useBlockNumberAsEpochId, protocolStateAddress);
        require(dataMarket.isInitialized(), "Failed to initialize DataMarket");

        // Emit event for the newly created DataMarket
        emit DataMarketCreated(ownerAddress, epochSize, sourceChainId, sourceChainBlockTime, useBlockNumberAsEpochId, protocolStateAddress, address(dataMarket));

        return dataMarket;
    }

}

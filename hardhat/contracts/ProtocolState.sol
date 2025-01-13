//SPDX-License-Identifier: MIT
/* Copyright (c) 2023 PowerLoom, Inc. */

pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {PowerloomNodes} from "./SnapshotterState.sol";
import {DataMarketFactory} from "./DataMarketFactory.sol";
import {PowerloomDataMarket} from "./DataMarket.sol";

/**
 * @title PowerloomProtocolState
 * @dev This contract manages the state of the Powerloom Protocol, including data markets and snapshotter assignments.
 * It inherits from Initializable, OwnableUpgradeable, and UUPSUpgradeable.
 */
contract PowerloomProtocolState is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;
    
    /**
     * @dev Struct to store information about a data market
     */
    struct DataMarketInfo{
        address ownerAddress;
        uint8 epochSize;
        uint256 sourceChainId;
        uint256 sourceChainBlockTime;
        bool useBlockNumberAsEpochId;
        bool enabled;
        address dataMarketAddress;
        uint256 createdAt;
    }

    struct UserInfo {
        uint256 totalRewards;
        uint256 totalClaimed;
        uint256 lastClaimed;
        uint256 lastUpdated;
    }

    PowerloomNodes public snapshotterState;
    DataMarketFactory public dataMarketFactory;

    mapping(uint256 => uint256) public slotRewards;

    uint8 public dataMarketCount;
    mapping(uint8 dataMarketId => address dataMarketAddress) public dataMarketIdToAddress;
    mapping(address => DataMarketInfo) public dataMarkets; 
    mapping(address => UserInfo) public userInfo;

    // Events
    event DayStartedEvent(address indexed dataMarketAddress, uint256 dayId, uint256 timestamp);
    event DailyTaskCompletedEvent(address indexed dataMarketAddress, address snapshotterAddress, uint256 slotId, uint256 dayId, uint256 timestamp);
    event RewardsDistributedEvent(address indexed dataMarketAddress, address snapshotterAddress, uint256 slotId, uint256 dayId, uint256 rewardPoints, uint256 timestamp);
    event ValidatorsUpdated(address indexed dataMarketAddress, address validatorAddress, bool allowed);
    event SequencersUpdated(address indexed dataMarketAddress, address sequencerAddress, bool allowed);
    event AdminsUpdated(address indexed dataMarketAddress, address adminAddress, bool allowed);
       
    // TODO: !IMPORTANT - Build commit and reveal mechansim in contract [TBD Later]

    // Snapshotter-related events
    event EpochReleased(address indexed dataMarketAddress, uint256 indexed epochId, uint256 begin, uint256 end, uint256 timestamp);
    
    event DelayedAttestationSubmitted(address indexed dataMarketAddress, string batchCid, uint256 indexed epochId, uint256 timestamp, address indexed validatorAddr);
    event DelayedBatchSubmitted(address indexed dataMarketAddress, string batchCid, uint256 indexed epochId, uint256 timestamp);

    event SnapshotFinalized(address indexed dataMarketAddress, uint256 indexed epochId, uint256 epochEnd, string projectId, string snapshotCid, uint256 timestamp);

    event SnapshotBatchSubmitted(address indexed dataMarketAddress, string batchCid, uint256 indexed epochId, uint256 timestamp);
    event SnapshotBatchAttestationSubmitted(address indexed dataMarketAddress, string batchCid, uint256 indexed epochId, uint256 timestamp, address indexed validatorAddr);
    event SnapshotBatchFinalized(address indexed dataMarketAddress, uint256 indexed epochId, string indexed batchCid, uint256 timestamp);
    event ValidatorAttestationsInvalidated(address indexed dataMarketAddress, uint256 indexed epochId, string indexed batchCid, address validator, uint256 timestamp);
    event TriggerBatchResubmission(address indexed dataMarketAddress, uint256 indexed epochId, string indexed batchCid, uint256 timestamp);
    event BatchSubmissionsCompleted(address indexed dataMarketAddress, uint256 indexed epochId, uint256 timestamp);

    event DelayedSnapshotSubmitted(address indexed dataMarketAddress, address indexed snapshotterAddr, uint256 slotId, string snapshotCid, uint256 indexed epochId, string projectId, uint256 timestamp);
    event EmergencyWithdraw(address indexed owner, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount, uint256 timestamp);
    /**
     * @dev Initializes the contract
     * @param initialOwner The address of the initial owner of the contract
     */
    function initialize(
        address initialOwner
    ) initializer public {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    // receive ETH
    receive() external payable {}


    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(){
        _disableInitializers();
    }

    /**
     * @dev Function to authorize an upgrade of the contract
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}

    /* DataMarket Factory Methods */

    /**
     * @dev Creates a new data market
     * @param ownerAddress The address of the owner of the new data market
     * @param epochSize The size of each epoch
     * @param sourceChainId The ID of the source chain
     * @param sourceChainBlockTime The block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @return The address of the newly created data market
     */
    function createDataMarket(
        address ownerAddress,
        uint8 epochSize,
        uint256 sourceChainId,
        uint256 sourceChainBlockTime,
        bool useBlockNumberAsEpochId
    ) public onlyOwner returns (address) {
        PowerloomDataMarket dataMarket = dataMarketFactory.createDataMarket(
            ownerAddress, epochSize, sourceChainId, sourceChainBlockTime, useBlockNumberAsEpochId, address(this)
            );
        dataMarkets[address(dataMarket)] = DataMarketInfo(ownerAddress, epochSize, sourceChainId, sourceChainBlockTime, useBlockNumberAsEpochId, true, address(dataMarket), block.timestamp);
        dataMarketCount++;
        dataMarketIdToAddress[dataMarketCount] = address(dataMarket);
        emit DataMarketFactory.DataMarketCreated(ownerAddress, epochSize, sourceChainId, sourceChainBlockTime, useBlockNumberAsEpochId, address(this), address(dataMarket));
        return address(dataMarket);
    }

    /* Protocol State */

    /**
     * @dev Updates the address of the data market factory
     * @param _address The new address of the data market factory
     */
    function updateDataMarketFactory(address _address) external onlyOwner {
        dataMarketFactory = DataMarketFactory(_address);
    }

    /**
     * @dev Updates the address of the snapshotter state contract
     * @param _address The new address of the snapshotter state contract
     */
    function updateSnapshotterState(address _address) external onlyOwner {
        snapshotterState = PowerloomNodes(payable(_address));
    }

    /**
     * @dev Retrieves the rewards for a given slot
     * @param slotId The ID of the slot
     * @return rewards The amount of rewards for the slot
     */
    function getSlotRewards(uint256 slotId) public view returns (uint256 rewards) {
        return slotRewards[slotId];
    }

    /**
     * @dev Toggles the enabled status of a data market
     * @param dataMarketAddress The address of the data market
     * @param enabled The new enabled status
     */
    function toggleDataMarket(address dataMarketAddress, bool enabled) public onlyOwner {
        DataMarketInfo storage dataMarket = dataMarkets[dataMarketAddress];
        dataMarket.enabled = enabled;
    }

    /**
     * @dev Checks if a data market is enabled
     * @param dataMarketAddress The address of the data market
     * @return A boolean indicating whether the data market is enabled
     */
    function dataMarketEnabled(address dataMarketAddress) public view returns (bool) {
        return dataMarkets[dataMarketAddress].enabled;
    }


    /* Snapshotter State */

    /**
     * @dev Checks if an address is a snapshotter
     * @param addr The address to check
     * @return A boolean indicating whether the address is a snapshotter
     */
    function allSnapshotters(address addr) public view returns(bool) {
        return snapshotterState.allSnapshotters(addr);
    }

    /**
     * @dev Gets the total count of snapshotters
     * @return The total count of snapshotters
     */
    function getTotalSnapshotterCount() public view returns(uint256) {
        return snapshotterState.getTotalSnapshotterCount();
    }

    /**
     * @dev Gets the total count of nodes
     * @return The total count of nodes
     */
    function getTotalNodeCount() public view returns(uint256) {
        return snapshotterState.nodeCount();
    }

    /**
     * @dev Gets the snapshotter address for a given slot
     * @param slotId The ID of the slot
     * @return The address of the snapshotter assigned to the slot
     */
    function slotSnapshotterMapping(uint256 slotId) external view returns (address) {
        return snapshotterState.nodeSnapshotterMapping(slotId);
    }

    /**
     * @dev Gets the current slot counter
     * @return The current slot counter
     */
    function enabledNodeCount() external view returns (uint256) {
        return snapshotterState.enabledNodeCount();
    }


    /* DataMarket Admin */

    /**
     * @dev Updates addresses for a specific role in a data market
     * @param dataMarket The data market contract
     * @param role The role to update
     * @param _addresses An array of addresses to update
     * @param _status An array of boolean statuses corresponding to the addresses
     */
    function updateAddresses(
        PowerloomDataMarket dataMarket,  
        PowerloomDataMarket.Role role, 
        address[] calldata _addresses, 
        bool[] calldata _status
    ) external {
        PowerloomDataMarket.Role ROLE = dataMarket.updateAddresses(role, _addresses, _status);
        for (uint256 i = 0; i < _addresses.length; i++) {
            if (ROLE == PowerloomDataMarket.Role.VALIDATOR) {
                emit ValidatorsUpdated(address(dataMarket), _addresses[i], _status[i]);
            } else if (ROLE== PowerloomDataMarket.Role.SEQUENCER) {
                emit SequencersUpdated(address(dataMarket), _addresses[i], _status[i]);
            }
            else if (ROLE == PowerloomDataMarket.Role.ADMIN) {
                emit AdminsUpdated(address(dataMarket), _addresses[i], _status[i]);
            }
        }  
    }

    /**
     * @dev Updates the minimum number of attestations required for consensus
     * @param dataMarket The data market contract
     * @param _minAttestationsForConsensus The new minimum number of attestations for consensus
     */
    function updateMinAttestationsForConsensus(PowerloomDataMarket dataMarket, uint256 _minAttestationsForConsensus) external {
        dataMarket.updateMinAttestationsForConsensus(_minAttestationsForConsensus);
    }

    /**
     * @dev Updates the batch submission window
     * @param dataMarket The data market contract
     * @param newbatchSubmissionWindow The new batch submission window
     */
    function updateBatchSubmissionWindow(PowerloomDataMarket dataMarket, uint256 newbatchSubmissionWindow) external {
        dataMarket.updateBatchSubmissionWindow(newbatchSubmissionWindow);
    }

    /**
     * @dev Updates the snapshot submission window
     * @param dataMarket The data market contract
     * @param newsnapshotSubmissionWindow The new snapshot submission window
     */
    function updateSnapshotSubmissionWindow(PowerloomDataMarket dataMarket, uint256 newsnapshotSubmissionWindow) external {
        dataMarket.updateSnapshotSubmissionWindow(newsnapshotSubmissionWindow);
    }

    /**
     * @dev Updates the attestation submission window
     * @param dataMarket The data market contract
     * @param newattestationSubmissionWindow The new attestation submission window
     */
    function updateAttestationSubmissionWindow(PowerloomDataMarket dataMarket, uint256 newattestationSubmissionWindow) external{
        dataMarket.updateAttestationSubmissionWindow(newattestationSubmissionWindow);
    }

    /**
     * @dev Loads slot submissions for a specific day
     * @param dataMarket The data market contract
     * @param slotId The ID of the slot
     * @param dayId The ID of the day
     * @param snapshotCount The number of snapshots
     */
    function loadSlotSubmissions(PowerloomDataMarket dataMarket, uint256 slotId, uint256 dayId, uint256 snapshotCount) external {
        dataMarket.loadSlotSubmissions(slotId, dayId, snapshotCount);
    }

    /**
     * @dev Loads the current day
     * @param dataMarket The data market contract
     * @param _dayCounter The day counter to set
     */
    function loadCurrentDay(PowerloomDataMarket dataMarket, uint256 _dayCounter) external {
        dataMarket.loadCurrentDay(_dayCounter);
    }


    /* DataMarket State */

    /**
     * @dev Gets the deployment block number of a data market
     * @param dataMarket The data market contract
     * @return The deployment block number
     */
    function deploymentBlockNumber(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.deploymentBlockNumber();
    }

    /**
     * @dev Gets the snapshot submission window of a data market
     * @param dataMarket The data market contract
     * @return The snapshot submission window
     */
    function snapshotSubmissionWindow(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.snapshotSubmissionWindow();
    }

    /**
     * @dev Gets the batch submission window of a data market
     * @param dataMarket The data market contract
     * @return The batch submission window
     */
    function batchSubmissionWindow(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.batchSubmissionWindow();
    }

    /**
     * @dev Gets the attestation submission window of a data market
     * @param dataMarket The data market contract
     * @return The attestation submission window
     */
    function attestationSubmissionWindow(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.attestationSubmissionWindow();
    }

    /**
     * @dev Gets the minimum number of attestations required for consensus in a data market
     * @param dataMarket The data market contract
     * @return The minimum number of attestations for consensus
     */
    function minAttestationsForConsensus(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.minAttestationsForConsensus();
    }



    /* DataMarket Epoch */

    /**
     * @dev Gets the epoch manager address of a data market
     * @param dataMarket The data market contract
     * @return The epoch manager address
     */
    function epochManager(PowerloomDataMarket dataMarket) public view returns(address) {
        return dataMarket.epochManager();
    }

    /**
     * @dev Gets the epoch manager address of a data market (alias for epochManager)
     * @param dataMarket The data market contract
     * @return The epoch manager address
     */
    function getEpochManager(PowerloomDataMarket dataMarket) public view returns(address) {
        return dataMarket.getEpochManager();
    }

    /**
     * @dev Updates the epoch manager address of a data market
     * @param dataMarket The data market contract
     * @param _address The new epoch manager address
     */
    function updateEpochManager(PowerloomDataMarket dataMarket, address _address) external {
        dataMarket.updateEpochManager(_address);
    }

    /**
     * @dev Gets the epoch size of a data market
     * @param dataMarket The data market contract
     * @return The epoch size
     */
    function EPOCH_SIZE(PowerloomDataMarket dataMarket) public view returns(uint8) {
        return dataMarket.EPOCH_SIZE();
    }

    /**
     * @dev Gets the source chain ID of a data market
     * @param dataMarket The data market contract
     * @return The source chain ID
     */
    function SOURCE_CHAIN_ID(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.SOURCE_CHAIN_ID();
    }

    /**
     * @dev Gets the source chain block time of a data market
     * @param dataMarket The data market contract
     * @return The source chain block time
     */
    function SOURCE_CHAIN_BLOCK_TIME(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.SOURCE_CHAIN_BLOCK_TIME();
    }

    /**
     * @dev Checks if a data market uses block number as epoch ID
     * @param dataMarket The data market contract
     * @return A boolean indicating whether block number is used as epoch ID
     */
    function USE_BLOCK_NUMBER_AS_EPOCH_ID(PowerloomDataMarket dataMarket) public view returns(bool) {
        return dataMarket.USE_BLOCK_NUMBER_AS_EPOCH_ID();
    }

    /**
     * @dev Gets the day size of a data market
     * @param dataMarket The data market contract
     * @return The day size
     */
    function DAY_SIZE(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.DAY_SIZE();
    }

    /**
     * @dev Gets the number of epochs in a day for a data market
     * @param dataMarket The data market contract
     * @return The number of epochs in a day
     */
    function epochsInADay(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.epochsInADay();
    }

    /**
     * @dev Gets the epoch information for a specific epoch ID
     * @param dataMarket The data market contract
     * @param epochId The ID of the epoch
     * @return timestamp The timestamp of the epoch
     * @return blocknumber The block number of the epoch
     * @return epochEnd The end of the epoch
     */
    function epochInfo(PowerloomDataMarket dataMarket, uint256 epochId) public view returns (uint256 timestamp, uint256 blocknumber, uint256 epochEnd) {
        return dataMarket.epochInfo(epochId);
    }

    /**
     * @dev Gets the current epoch information
     * @param dataMarket The data market contract
     * @return begin The beginning of the current epoch
     * @return end The end of the current epoch
     * @return epochId The ID of the current epoch
     */
    function currentEpoch(PowerloomDataMarket dataMarket) public view returns (uint256 begin, uint256 end, uint256 epochId) {
        return dataMarket.currentEpoch();
    }

    /**
     * @dev Forces skipping an epoch
     * @param dataMarket The data market contract
     * @param begin The beginning of the epoch to skip
     * @param end The end of the epoch to skip
     */
    function forceSkipEpoch(PowerloomDataMarket dataMarket, uint256 begin, uint256 end) external {
        dataMarket.forceSkipEpoch(begin, end);
        emit EpochReleased(address(dataMarket), dataMarket.epochIdCounter(), begin, end, block.timestamp);
    }

    /**
     * @dev Releases an epoch
     * @param dataMarket The data market contract
     * @param begin The beginning of the epoch to release
     * @param end The end of the epoch to release
     */
    function releaseEpoch(PowerloomDataMarket dataMarket, uint256 begin, uint256 end) external {
        (bool DAY_STARTED, bool EPOCH_RELEASED) = dataMarket.releaseEpoch(begin, end);
        if(DAY_STARTED){
            emit DayStartedEvent(address(dataMarket), dataMarket.dayCounter(), block.timestamp);
        }
        if(EPOCH_RELEASED){
            emit EpochReleased(address(dataMarket), dataMarket.epochIdCounter(), begin, end, block.timestamp);
        }
    }

    /**
     * @dev Gets the batch CIDs for a specific epoch
     * @param dataMarket The data market contract
     * @param epochId The ID of the epoch
     * @return An array of batch CIDs
     */
    function epochIdToBatchCids(PowerloomDataMarket dataMarket, uint256 epochId) public view returns (string[] memory) {
        return dataMarket.getEpochIdToBatchCids(epochId);
    }

    /* DataMarket Sequencer */

    /**
     * @dev Gets the sequencer ID of a data market
     * @param dataMarket The data market contract
     * @return The sequencer ID
     */
    function getSequencerId(PowerloomDataMarket dataMarket) public view returns (string memory) {
        return dataMarket.sequencerId();
    }

    /**
     * @dev Sets the sequencer ID of a data market
     * @param dataMarket The data market contract
     * @param _sequencerId The new sequencer ID
     */
    function setSequencerId(PowerloomDataMarket dataMarket, string memory _sequencerId) public {
        dataMarket.setSequencerId(_sequencerId);
    }

    /**
     * @dev Gets the sequencer attestation for a batch CID
     * @param dataMarket The data market contract
     * @param batchCid The batch CID
     * @return The sequencer attestation
     */
    function batchCidSequencerAttestation(PowerloomDataMarket dataMarket, string memory batchCid) public view returns (bytes32) {
        return dataMarket.batchCidSequencerAttestation(batchCid);
    }

    /**
     * @dev Gets all sequencers of a data market
     * @param dataMarket The data market contract
     * @return An array of sequencer addresses
     */
    function getSequencers(PowerloomDataMarket dataMarket) public view returns(address[] memory) {
        return dataMarket.getSequencers();
    }

    /**
     * @dev Gets the total count of sequencers in a data market
     * @param dataMarket The data market contract
     * @return The total count of sequencers
     */
    function getTotalSequencersCount(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.getTotalSequencersCount();
    }


    /* DataMarket Validator */

    /**
     * @dev Gets all validators of a data market
     * @param dataMarket The data market contract
     * @return An array of validator addresses
     */
    function getValidators(PowerloomDataMarket dataMarket) public view returns(address[] memory) {
        return dataMarket.getValidators();
    }

    /**
     * @dev Gets the total count of validators in a data market
     * @param dataMarket The data market contract
     * @return The total count of validators
     */
    function getTotalValidatorsCount(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.getTotalValidatorsCount();
    }

    /**
     * @dev Checks if attestations have been received for a batch CID from a validator
     * @param dataMarket The data market contract
     * @param batchCid The batch CID
     * @param validator The validator address
     * @return A boolean indicating whether attestations have been received
     */
    function attestationsReceived(PowerloomDataMarket dataMarket, string memory batchCid, address validator) public view returns (bool) {
        return dataMarket.attestationsReceived(batchCid, validator);
    }

    /**
     * @dev Gets a divergent validator for a batch CID
     * @param dataMarket The data market contract
     * @param batchCid The batch CID
     * @param idx The index of the divergent validator
     * @return The address of the divergent validator
     */
    function batchCidDivergentValidators(PowerloomDataMarket dataMarket, string memory batchCid, uint256 idx) public view returns (address) {
        return dataMarket.batchCidDivergentValidators(batchCid, idx);
    }


    /* DataMarket Slot Rewards */

    /**
     * @dev Toggles the rewards status of a data market
     * @param dataMarket The data market contract
     */
    function toggleRewards(PowerloomDataMarket dataMarket) external {
        dataMarket.toggleRewards();
    }

    /**
     * @dev Checks if rewards are enabled for a data market
     * @param dataMarket The data market contract
     * @return A boolean indicating whether rewards are enabled
     */
    function rewardsEnabled(PowerloomDataMarket dataMarket) public view returns(bool) {
        return dataMarket.rewardsEnabled();
    }

    /**
     * @dev Gets the reward pool size of a data market
     * @param dataMarket The data market contract
     * @return The reward pool size
     */
    function rewardPoolSize(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.rewardPoolSize();
    }

    /**
     * @dev Updates the reward pool size of a data market
     * @param dataMarket The data market contract
     * @param newRewardPoolSize The new reward pool size
     */
    function updateRewardPoolSize(PowerloomDataMarket dataMarket, uint256 newRewardPoolSize) external {
        dataMarket.updateRewardPoolSize(newRewardPoolSize);
    }

    /**
     * @dev Updates the day size of a data market
     * @param dataMarket The data market contract
     * @param newDaySize The new day size
     */
    function updateDaySize(PowerloomDataMarket dataMarket, uint256 newDaySize) external {
        dataMarket.updateDaySize(newDaySize);
    }

    /**
     * @dev Gets the daily snapshot quota of a data market
     * @param dataMarket The data market contract
     * @return The daily snapshot quota
     */
    function dailySnapshotQuota(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.dailySnapshotQuota();
    }

    /**
     * @dev Updates the daily snapshot quota of a data market
     * @param dataMarket The data market contract
     * @param _dailySnapshotQuota The new daily snapshot quota
     */
    function updateDailySnapshotQuota(PowerloomDataMarket dataMarket, uint256 _dailySnapshotQuota) external {
        dataMarket.updateDailySnapshotQuota(_dailySnapshotQuota);
    }

    /**
     * @dev Gets the day counter of a data market
     * @param dataMarket The data market contract
     * @return The day counter
     */
    function dayCounter(PowerloomDataMarket dataMarket) public view returns(uint256) {
        return dataMarket.dayCounter();
    }

    /**
     * @dev Gets the submission count for a slot on a specific day
     * @param dataMarket The data market contract
     * @param slotId The ID of the slot
     * @param dayId The ID of the day
     * @return The submission count
     */
    function slotSubmissionCount(PowerloomDataMarket dataMarket, uint256 slotId, uint256 dayId) public view returns (uint256) {
        return dataMarket.slotSubmissionCount(slotId, dayId);
    }

    /**
     * @dev Gets the reward points for a slot
     * @param dataMarket The data market contract
     * @param slotId The ID of the slot
     * @return The reward points
     */
    function slotRewardPoints(PowerloomDataMarket dataMarket, uint256 slotId) public view returns (uint256) {
        return dataMarket.slotRewardPoints(slotId);
    }

    /**
     * @dev Gets the slot information for a specific slot
     * @param dataMarket The data market contract
     * @param slotId The ID of the slot
     * @return The slot information
     */
    function getSlotInfo(PowerloomDataMarket dataMarket, uint256 slotId) public view returns (PowerloomDataMarket.SlotInfo memory){
        return dataMarket.getSlotInfo(slotId);
     }

    /**
     * @dev Checks the task status for a slot on a specific day
     * @param dataMarket The data market contract
     * @param slotId The ID of the slot
     * @param day The day to check
     * @return A boolean indicating the task status
     */
    function checkSlotTaskStatusForDay(PowerloomDataMarket dataMarket, uint256 slotId, uint256 day) public view returns (bool){
        return dataMarket.checkSlotTaskStatusForDay(slotId, day);
    }

    /**
     * @dev Updates submissions for multiple slots based on their submissions, and updates rewards if eligible nodes are set for the day
     * @param dataMarket The data market contract
     * @param slotIds Array of slot IDs to update
     * @param submissionsList Array of submission counts corresponding to each slot
     * @param day The day for which rewards are being updated
     * @notice This function updates rewards and emits a DailyTaskCompletedEvent if applicable.
     * @notice Only callable by the sequencer
     */
    function updateRewards(
        PowerloomDataMarket dataMarket,
        uint256[] memory slotIds,
        uint256[] memory submissionsList,
        uint256 day,
        uint256 eligibleNodes
    ) external {
        if (eligibleNodes != 0) {
            dataMarket.updateEligibleNodesForDay(day, eligibleNodes);
        }
        // Iterate through all provided slots
        for (uint i = 0; i < slotIds.length; i++) {
            bool status = dataMarket.updateRewards(slotIds[i], submissionsList[i], day);
            if(status){
                address slotOwner = snapshotterState.nodeIdToOwner(slotIds[i]);
                (address snapshotterAddress,,,,,,,,,) = snapshotterState.nodeInfo(slotIds[i]);
                emit DailyTaskCompletedEvent(address(dataMarket), snapshotterAddress, slotIds[i], day, block.timestamp);
                if (eligibleNodes != 0) {
                    UserInfo storage user = userInfo[slotOwner];
                    uint256 rewards = dataMarket.rewardPoolSize() / dataMarket.eligibleNodesForDay(day);
                    user.totalRewards += rewards;
                    user.lastUpdated = block.timestamp;
                    slotRewards[slotIds[i]] += rewards;
                    emit RewardsDistributedEvent(address(dataMarket), snapshotterAddress, slotIds[i], day, rewards, block.timestamp);
                }
            }
        }
    }

    /**
     * @dev Claims rewards for a user
     * @param _user The address of the user
     */
    function claimRewards(address _user) external {
        UserInfo storage user = userInfo[_user];
        uint256 rewards = user.totalRewards - user.totalClaimed;
        require(rewards > 0, "No rewards to claim");
        user.totalClaimed += rewards;
        user.lastClaimed = block.timestamp;
        payable(_user).transfer(rewards);
        emit RewardsClaimed(_user, rewards, block.timestamp);
    }


    /* DataMarket Projects */

    /**
     * @dev Gets the first epoch ID for a specific project
     * @param dataMarket The data market contract
     * @param projectId The ID of the project
     * @return uint256 The first epoch ID for the project
     */
    function projectFirstEpochId(PowerloomDataMarket dataMarket, string memory projectId) public view returns (uint256) {
        return dataMarket.projectFirstEpochId(projectId);
    }

    /**
     * @dev Gets the projects associated with a specific batch CID
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @return string[] Array of project IDs associated with the batch
     */
    function batchCidToProjects(PowerloomDataMarket dataMarket, string memory batchCid) public view returns (string[] memory) {
        return dataMarket.getBatchCidToProjects(batchCid);
    }


    /* DataMarket Snapshot Submission */

    /**
     * @dev Gets the snapshot status for a specific project and epoch
     * @param dataMarket The data market contract
     * @param projectId The ID of the project
     * @param epochId The ID of the epoch
     * @return status The status of the snapshot
     * @return snapshotCid The CID of the snapshot
     * @return timestamp The timestamp of the snapshot
     */
    function snapshotStatus(PowerloomDataMarket dataMarket, string memory projectId, uint256 epochId) public view returns (PowerloomDataMarket.SnapshotStatus status, string memory snapshotCid, uint256 timestamp) {
        return dataMarket.snapshotStatus(projectId, epochId);
    }

    /**
     * @dev Gets the last finalized snapshot for a project
     * @param dataMarket The data market contract
     * @param projectId The ID of the project
     * @return uint256 The epoch ID of the last finalized snapshot
     */
    function lastFinalizedSnapshot(PowerloomDataMarket dataMarket, string memory projectId) public view returns (uint256) {
        return dataMarket.lastFinalizedSnapshot(projectId);
    }

    /**
     * @dev Gets the last sequencer finalized snapshot for a project
     * @param dataMarket The data market contract
     * @param projectId The ID of the project
     * @return uint256 The epoch ID of the last sequencer finalized snapshot
     */
    function lastSequencerFinalizedSnapshot(PowerloomDataMarket dataMarket, string memory projectId) public view returns (uint256) {
        return dataMarket.lastSequencerFinalizedSnapshot(projectId);
    }

    /**
     * @dev Gets the CID of the snapshot with the maximum attestations for a project and epoch
     * @param dataMarket The data market contract
     * @param projectId The ID of the project
     * @param epochId The ID of the epoch
     * @return string The CID of the snapshot with max attestations
     */
    function maxSnapshotsCid(PowerloomDataMarket dataMarket, string memory projectId, uint256 epochId) public view returns (string memory) {
        return dataMarket.maxSnapshotsCid(projectId, epochId);
    }

    /**
     * @dev Submits a batch of snapshots
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param epochId The ID of the epoch
     * @param projectIds Array of project IDs in the batch
     * @param snapshotCids Array of snapshot CIDs corresponding to each project
     * @param finalizedCidsRootHash The root hash of the merkle tree constructed from finalized CIDs
     * @notice Emits SnapshotBatchSubmitted or DelayedBatchSubmitted events based on the submission result
     */
    function submitSubmissionBatch(
        PowerloomDataMarket dataMarket,
        string memory batchCid,
        uint256 epochId,
        string[] memory projectIds,
        string[] memory snapshotCids,
        bytes32 finalizedCidsRootHash
    ) external {
        (bool SNAPSHOT_BATCH_SUBMITTED, bool DELAYED_BATCH_SUBMITTED) = dataMarket.submitSubmissionBatch(batchCid, epochId, projectIds, snapshotCids, finalizedCidsRootHash);
        if(SNAPSHOT_BATCH_SUBMITTED){
            emit SnapshotBatchSubmitted(address(dataMarket), batchCid, epochId, block.timestamp);        
        }
        if(DELAYED_BATCH_SUBMITTED){
            emit DelayedBatchSubmitted(address(dataMarket), batchCid, epochId, block.timestamp);
        }
    }

    /* DataMarket Consensus */

    /**
     * @dev Checks if dynamic consensus attestations are complete for a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param epochId The ID of the epoch
     * @return bool indicating if consensus attestations are complete
     */
    function checkDynamicConsensusAttestations(PowerloomDataMarket dataMarket, string memory batchCid, uint256 epochId) public view returns (bool){
        return dataMarket.checkDynamicConsensusAttestations(batchCid, epochId);
    }

    /**
     * @dev Forces completion of consensus attestations for a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param epochId The ID of the epoch
     * @notice Emits TriggerBatchResubmission or SnapshotBatchFinalized events based on the result
     */
    function forceCompleteConsensusAttestations(PowerloomDataMarket dataMarket, string memory batchCid, uint256 epochId) public {
        bool TRIGGER_BATCH_RESUBMISSION = dataMarket.forceCompleteConsensusAttestations(batchCid, epochId);
        if(TRIGGER_BATCH_RESUBMISSION){
            emit TriggerBatchResubmission(address(dataMarket), epochId, batchCid, block.timestamp);
        } else {
            _finalizeSnapshotBatchEvents(dataMarket, batchCid, epochId);
            emit SnapshotBatchFinalized(address(dataMarket), epochId, batchCid, block.timestamp);
        }
    }

    /**
     * @dev Gets the count of attestations received for a specific batch and finalized CIDs root hash
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param finalizedCidsRootHash The root hash of finalized CIDs
     * @return uint256 The count of attestations received
     */
    function attestationsReceivedCount(PowerloomDataMarket dataMarket, string memory batchCid, bytes32 finalizedCidsRootHash) public view returns (uint256) {
        return dataMarket.attestationsReceivedCount(batchCid, finalizedCidsRootHash);
    }

    /**
     * @dev Gets the maximum number of attestations received for a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @return uint256 The maximum number of attestations
     */
    function maxAttestationsCount(PowerloomDataMarket dataMarket, string memory batchCid) public view returns (uint256) {
        return dataMarket.maxAttestationsCount(batchCid);
    }

    /**
     * @dev Gets the finalized CIDs root hash with the maximum attestations for a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @return bytes32 The root hash with maximum attestations
     */
    function maxAttestationFinalizedRootHash(PowerloomDataMarket dataMarket, string memory batchCid) public view returns (bytes32) {
        return dataMarket.maxAttestationFinalizedRootHash(batchCid);
    }

    /**
     * @dev Checks the attestation status of a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @return bool indicating the attestation status
     */
    function batchCidAttestationStatus(PowerloomDataMarket dataMarket, string memory batchCid) public view returns (bool) {
        return dataMarket.batchCidAttestationStatus(batchCid);
    }
    
    /**
     * @dev Submits an attestation for a batch
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param epochId The ID of the epoch
     * @param finalizedCidsRootHash The root hash of the merkle tree constructed from finalized CIDs
     * @notice Emits SnapshotBatchAttestationSubmitted or DelayedAttestationSubmitted events based on the submission result
     */
    function submitBatchAttestation(
        PowerloomDataMarket dataMarket,
        string memory batchCid,
        uint256 epochId,
        bytes32 finalizedCidsRootHash
    ) external {
        bool SNAPSHOT_BATCH_ATTESTATION_SUBMITTED = dataMarket.submitBatchAttestation(batchCid, epochId, finalizedCidsRootHash);
        if(SNAPSHOT_BATCH_ATTESTATION_SUBMITTED) {
            emit SnapshotBatchAttestationSubmitted(address(dataMarket), batchCid, epochId, block.timestamp, msg.sender);
        } else {
            emit DelayedAttestationSubmitted(address(dataMarket), batchCid, epochId, block.timestamp, msg.sender);
        }
    }

    /**
     * @dev Ends batch submissions for an epoch
     * @param dataMarket The data market contract
     * @param epochId The ID of the epoch
     * @notice Emits a BatchSubmissionsCompleted event
     */
    function endBatchSubmissions(PowerloomDataMarket dataMarket, uint256 epochId) public {
        dataMarket.endBatchSubmissions(epochId);
        emit BatchSubmissionsCompleted(address(dataMarket), epochId, block.timestamp);
    }


    /* Private */

    /**
     * @dev Finalizes snapshot batch events
     * @param dataMarket The data market contract
     * @param batchCid The CID of the batch
     * @param epochId The ID of the epoch
     * @notice This function is called internally to finalize snapshot events and emit relevant events
     */
    function _finalizeSnapshotBatchEvents(PowerloomDataMarket dataMarket, string memory batchCid, uint256 epochId) private {
        // Emit events for divergent validators
        for (uint i = 0; i < dataMarket.batchCidDivergentValidatorsLen(batchCid); i++) {
                emit ValidatorAttestationsInvalidated(address(dataMarket), epochId, batchCid, dataMarket.batchCidDivergentValidators(batchCid, i), block.timestamp);
        } 
        (,,uint256 epochEnd) = dataMarket.epochInfo(epochId);

        // Emit SnapshotFinalized events for each project in the batch
        for (uint i = 0; i < dataMarket.batchCidToProjectsLen(batchCid); i++) {
            for (uint j = 0; j < dataMarket.batchCidToProjectsLen(batchCid); j++) {
                string memory project = dataMarket.batchCidToProjects(batchCid, j);

                (,string memory projectCid,) = dataMarket.snapshotStatus(project, epochId);
                if (bytes(projectCid).length > 0) {
                    emit SnapshotFinalized(address(dataMarket), epochId, epochEnd, project, projectCid, block.timestamp);
                }
            }
        }
    }

    /**
     * @dev Allows the owner to withdraw all funds from the contract in case of emergency
     */
    function emergencyWithdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
        emit EmergencyWithdraw(msg.sender, balance);
    }

}
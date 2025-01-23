//SPDX-License-Identifier: MIT
/* Copyright (c) 2023 PowerLoom, Inc. */

pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title IPowerloomProtocolState
 * @dev Interface for the PowerloomProtocolState contract
 */
interface IPowerloomProtocolState {
    /**
     * @dev Checks if a data market is enabled
     * @param _dataMarket Address of the data market
     * @return bool indicating if the data market is enabled
     */
    function dataMarketEnabled(address _dataMarket) external view returns (bool);

    /**
     * @dev Returns the SnapshotterState contract
     * @return ISnapshotterState interface of the SnapshotterState contract
     */
    function snapshotterState() external view returns (ISnapshotterState);
}

/**
 * @title ISnapshotterState
 * @dev Interface for the SnapshotterState contract
 */
interface ISnapshotterState {
    /**
     * @dev Returns the snapshotter address for a given node
     * @param nodeId The ID of the node
     * @return address of the snapshotter
     */
    function nodeSnapshotterMapping(uint256 nodeId) external view returns (address);

    /**
     * @dev Returns the total number of nodes
     * @return uint256 representing the node counter
     */
    function getTotalSnapshotterCount() external view returns (uint256);

    /**
     * @dev Checks if an address is a registered snapshotter
     * @param snapshotter Address to check
     * @return bool indicating if the address is a snapshotter
     */
    function allSnapshotters(address snapshotter) external view returns (bool);

    /**
     * @dev Checks if a node is available
     * @param _nodeId The ID of the node to check
     * @return bool indicating if the node is available
     */
    function isNodeAvailable(uint256 _nodeId) external view returns (bool);
}

/**
 * @title PowerloomDataMarket
 * @dev Main contract for managing the Powerloom data market
 */
contract PowerloomDataMarket is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    /**
     * @dev Struct to represent an epoch
     */
    struct Epoch {
        uint256 begin;
        uint256 end;
        uint256 epochId;
    }

    /**
     * @dev Enum to represent the status of a snapshot
     */
    enum SnapshotStatus {
        PENDING,
        FINALIZED
    }

    /**
     * @dev Enum to represent different roles in the system
     */
    enum Role {
        VALIDATOR,
        SEQUENCER,
        ADMIN
    }

    /**
     * @dev Struct to represent the consensus status of a snapshot
     */
    struct ConsensusStatus {
        SnapshotStatus status;
        string snapshotCid;
        uint256 timestamp;
    }

    /**
     * @dev Struct to store information about an epoch
     */
    struct EpochInfo {
        uint256 timestamp;
        uint256 blocknumber;
        uint256 epochEnd;
    }

    /**
     * @dev Struct to represent a snapshot request
     */
    struct Request {
        uint256 slotId;
        uint256 deadline;
        string snapshotCid;
        uint256 epochId;
        string projectId;
    }

    /**
     * @dev Struct to store information about a slot
     */
    struct SlotInfo {
        uint256 slotId;
        address snapshotterAddress;
        uint256 rewardPoints;
        uint256 currentDaySnapshotCount;
    }

    // Public state variables
    string public sequencerId;
    IPowerloomProtocolState public protocolState;
    Epoch public currentEpoch;
    uint256 public rewardPoolSize = 1_000_000e18;
    uint256 public dailySnapshotQuota = 50;
    uint256 public dayCounter = 1;
    uint256 public epochsInADay;
    uint256 public epochIdCounter = 0;
    address public epochManager;
    bool public isInitialized = false;
    uint8 public EPOCH_SIZE; // Number of Blocks in each Epoch
    uint256 public SOURCE_CHAIN_ID;
    uint256 public SOURCE_CHAIN_BLOCK_TIME; // Block time in seconds * 1e4 (to allow decimals)
    uint256 public deploymentBlockNumber;
    bool public USE_BLOCK_NUMBER_AS_EPOCH_ID;
    uint256 public DAY_SIZE = 864000000; // 24 hours in blocks
    bool public rewardsEnabled = true;
    uint256 public snapshotSubmissionWindow = 1; // Number of blocks to wait before finalizing epoch
    uint256 public batchSubmissionWindow = 1; // Number of blocks to wait before finalizing batch
    uint256 public attestationSubmissionWindow = 1; // Number of blocks to wait for attestation acceptance
    uint256 public minAttestationsForConsensus = 2; // Minimum number of attestations for consensus

    // Private state variables
    EnumerableSet.AddressSet private validatorSet;
    EnumerableSet.AddressSet private sequencerSet;
    EnumerableSet.AddressSet private adminSet;

    // Mappings
    mapping(uint256 => EpochInfo) public epochInfo;
    mapping(string batchCid => string[] projectids) public batchCidToProjects;
    mapping(uint256 epochId => string[] batchCids) public epochIdToBatchCids;
    mapping(string batchCid => mapping(address => bool)) public attestationsReceived;
    mapping(string batchCid => mapping(bytes32 finalizedCidsRootHash => uint256 count)) public attestationsReceivedCount;
    mapping(string batchCid => uint256 count) public maxAttestationsCount;
    mapping(string batchCid => bytes32 finalizedCidsRootHash) public maxAttestationFinalizedRootHash;
    mapping(string batchCid => bytes32 finalizedCidsRootHash) public batchCidSequencerAttestation;
    mapping(string batchCid => bool) public batchCidAttestationStatus;
    mapping(string batchCid => address[] validators) public batchCidDivergentValidators;
    mapping(uint256 epochId => bool batchSubmissionsCompleted) public epochIdToBatchSubmissionsCompleted;
    mapping(string projectId => mapping(uint256 epochId => ConsensusStatus)) public snapshotStatus;
    mapping(string projectId => uint256 epochId) public lastFinalizedSnapshot;
    mapping(string projectId => uint256 epochId) public lastSequencerFinalizedSnapshot;
    mapping(string projectId => uint256 epochId) public projectFirstEpochId;
    mapping(uint256 slotId => mapping(uint256 dayId => uint256 snapshotCount)) public slotSubmissionCount;
    mapping(uint256 slotId => uint256 slotRewardPoints) public slotRewardPoints;
    mapping(uint256 dayId => uint256 eligibleNodes) public eligibleNodesForDay;

    mapping(address validatorAddress => mapping(uint256 epochId => mapping(string batchCid => bool))) public validatorAttestationsReceived;

    // Events
    event DayStartedEvent(uint256 dayId, uint256 timestamp);
    event DailyTaskCompletedEvent(
        address snapshotterAddress,
        uint256 slotId,
        uint256 dayId,
        uint256 timestamp
    );
    event RewardsDistributedEvent(
        address snapshotterAddress,
        uint256 slotId,
        uint256 dayId,
        uint256 rewardPoints,
        uint256 timestamp
    );
    event ValidatorsUpdated(address validatorAddress, bool allowed);
    event SequencersUpdated(address sequencerAddress, bool allowed);
    event AdminsUpdated(address adminAddress, bool allowed);

    // TODO: !IMPORTANT - Build commit and reveal mechansim in contract [TBD Later]

    // Snapshotter-related events
    event EpochReleased(
        uint256 indexed epochId,
        uint256 begin,
        uint256 end,
        uint256 timestamp
    );

    event DelayedAttestationSubmitted(
        string batchCid,
        uint256 indexed epochId,
        uint256 timestamp,
        address indexed validatorAddr
    );
    event DelayedBatchSubmitted(
        string batchCid,
        uint256 indexed epochId,
        uint256 timestamp
    );

    event SnapshotFinalized(
        uint256 indexed epochId,
        uint256 epochEnd,
        string projectId,
        string snapshotCid,
        uint256 timestamp
    );

    event SnapshotBatchSubmitted(
        string batchCid,
        uint256 indexed epochId,
        uint256 timestamp
    );
    event SnapshotBatchAttestationSubmitted(
        string batchCid,
        uint256 indexed epochId,
        uint256 timestamp,
        address indexed validatorAddr
    );
    event SnapshotBatchFinalized(
        uint256 indexed epochId,
        string batchCid,
        uint256 timestamp
    );
    event ValidatorAttestationsInvalidated(
        uint256 indexed epochId,
        string batchCid,
        address validator,
        uint256 timestamp
    );
    event TriggerBatchResubmission(
        uint256 indexed epochId,
        string batchCid,
        uint256 timestamp
    );
    event BatchSubmissionsCompleted(uint256 indexed epochId, uint256 timestamp);



    /**
     * @dev Modifier to check if the contract is active
     */
    modifier isActive() {
        require(
            protocolState.dataMarketEnabled(address(this)),
            "E02"
        );
        _;
    }

    modifier onlyProtocolState() {
        require(
            msg.sender == address(protocolState),
            "E44"
        );
        _;
    }


    /**
     * @dev Constructor for the PowerloomDataMarket contract
     * @param ownerAddress Address of the contract owner
     * @param epochSize Size of each epoch
     * @param sourceChainId ID of the source chain
     * @param sourceChainBlockTime Block time of the source chain
     * @param useBlockNumberAsEpochId Whether to use block number as epoch ID
     * @param _protocolStateAddress Address of the ProtocolState contract
     */
    constructor(
        address ownerAddress,
        uint8 epochSize,
        uint256 sourceChainId,
        uint256 sourceChainBlockTime,
        bool useBlockNumberAsEpochId,
        address _protocolStateAddress
    ) Ownable(ownerAddress) {
        require(ownerAddress != address(0), "E45");
        EPOCH_SIZE = epochSize;
        SOURCE_CHAIN_ID = sourceChainId;
        // SOURCE CHAIN BLOCK TIME 10000 = 1 second
        SOURCE_CHAIN_BLOCK_TIME = sourceChainBlockTime;
        if (useBlockNumberAsEpochId) {
            require(
                epochSize == 1,
                "E10"
            );
        }
        USE_BLOCK_NUMBER_AS_EPOCH_ID = useBlockNumberAsEpochId;
        deploymentBlockNumber = block.number;
        // 24 should be divided by slotsPerDay
        epochsInADay = DAY_SIZE / (SOURCE_CHAIN_BLOCK_TIME * epochSize);
        protocolState = IPowerloomProtocolState(_protocolStateAddress);
        isInitialized = true;

    }


    function isValidator(address validatorAddress) public view returns (bool) {
        return validatorSet.contains(validatorAddress);
    }

    function isOwner(address ownerAddress) public view returns (bool) {
        return owner() == ownerAddress;
    }

    function isSequencer(address sequencerAddress) public view returns (bool) {
        return sequencerSet.contains(sequencerAddress);
    }

    function isAdmin(address adminAddress) public view returns (bool) {
        return adminSet.contains(adminAddress);
    }

    function isOwnerOrAdmin(address _address) public view returns (bool) {
        return isOwner(_address) || isAdmin(_address);
    }

    function isEpochManager(address _address) public view returns (bool) {
        return epochManager == _address;
    }

    /**
     * @dev Updates the DAY_SIZE and recalculates epochsInADay
     * @param _daySize New value for DAY_SIZE
     */
    function updateDaySize(uint256 _daySize, address _sender) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(_daySize > 0, "E45");
        DAY_SIZE = _daySize;
        epochsInADay = DAY_SIZE / (SOURCE_CHAIN_BLOCK_TIME * EPOCH_SIZE);
        require(epochsInADay != 0, "E45");
    }

    /**
     * @dev Retrieves the batch CIDs for a given epoch ID
     * @param epochId The epoch ID to query
     * @return An array of batch CIDs associated with the epoch
     */
    function getEpochIdToBatchCids(uint256 epochId)
        public
        view
        returns (string[] memory)
    {
        return epochIdToBatchCids[epochId];
    }

    /**
     * @dev Retrieves the projects associated with a given batch CID
     * @param batchCid The batch CID to query
     * @return An array of project IDs associated with the batch
     */
    function getBatchCidToProjects(string memory batchCid)
        public
        view
        returns (string[] memory)
    {
        return batchCidToProjects[batchCid];
    }

    /**
     * @dev Sets the sequencer ID
     * @param _sequencerId The new sequencer ID
     */
    function setSequencerId(string memory _sequencerId, address _sender) public onlyProtocolState {
        require(isOwnerOrAdmin(_sender), "E08");
        sequencerId = _sequencerId;
    }

    /**
     * @dev Toggles the rewards status
     */
    function toggleRewards(address _sender) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        rewardsEnabled = !rewardsEnabled;
    }

    /**
     * @dev Updates the daily snapshot quota
     * @param _dailySnapshotQuota The new daily snapshot quota
     */
    function updateDailySnapshotQuota(
        uint256 _dailySnapshotQuota, address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(_dailySnapshotQuota != 0, "E45");
        dailySnapshotQuota = _dailySnapshotQuota;
    }

    /**
     * @dev Updates the reward pool size
     * @param newRewardPoolSize The new reward pool size
     */
    function updateRewardPoolSize(
        uint256 newRewardPoolSize, address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        rewardPoolSize = newRewardPoolSize;
    }

    /**
     * @dev Updates the epoch manager address
     * @param _address The new epoch manager address
     */
    function updateEpochManager(address _address, address _sender) external onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(_address != address(0), "E45");
        epochManager = _address;
    }

    /**
     * @dev Internal function to get the appropriate address set based on role
     * @param role The role to get the address set for
     * @return The EnumerableSet.AddressSet for the specified role
     */
    function _getAddressSet(
        Role role
    ) internal view returns (EnumerableSet.AddressSet storage) {
        if (role == Role.VALIDATOR) {
            return validatorSet;
        } else if (role == Role.SEQUENCER) {
            return sequencerSet;
        } else {
            return adminSet;
        }
    }

    /**
     * @dev Updates addresses for a specific role
     * @param role The role to update addresses for
     * @param _addresses Array of addresses to update
     * @param _status Array of corresponding status values
     * @return ROLE The updated role
     */
    function updateAddresses(
        Role role,
        address[] calldata _addresses,
        bool[] calldata _status,
        address _sender
    ) external onlyProtocolState returns (Role ROLE) {
        require(isOwner(_sender), "E03");
        require(
            _addresses.length == _status.length,
            "E19"
        );

        EnumerableSet.AddressSet storage set = _getAddressSet(role);

        for (uint256 i = 0; i < _addresses.length; i++) {
            bool changed = false;
            if (_status[i]) {
                changed = set.add(_addresses[i]);
            } else {
                changed = set.remove(_addresses[i]);
            }
            if (changed) {
                if (role == Role.VALIDATOR) {
                    ROLE = Role.VALIDATOR;
                    emit ValidatorsUpdated(_addresses[i], _status[i]);
                } else if (role == Role.SEQUENCER) {
                    ROLE = Role.SEQUENCER;
                    emit SequencersUpdated(_addresses[i], _status[i]);
                } else {
                    ROLE = Role.ADMIN;
                    emit AdminsUpdated(_addresses[i], _status[i]);
                }
            }
        }
    }

    /**
     * @dev Forces skipping of epochs
     * @param begin The beginning block number of the new epoch
     * @param end The ending block number of the new epoch
     */
    function forceSkipEpoch(
        uint256 begin,
        uint256 end,
        address _sender
    ) public isActive onlyProtocolState returns (bool, bool) {
        require(isOwner(_sender), "E03");
        bool DAY_STARTED = false;
        bool EPOCH_RELEASED = false;

        require(end >= begin, "E20");
        require(end - begin + 1 == EPOCH_SIZE, "E21");
        require(((end - currentEpoch.end) % EPOCH_SIZE) == 0 , "E21");

        if (EPOCH_SIZE == 1 && USE_BLOCK_NUMBER_AS_EPOCH_ID) {
            epochIdCounter = end;
        } else {
            epochIdCounter += (end - currentEpoch.end) / EPOCH_SIZE;
        }
        currentEpoch = Epoch(begin, end, epochIdCounter);
        epochInfo[epochIdCounter] = EpochInfo(
            block.timestamp,
            block.number,
            end
        );

        // Check if a new day has started
        if (epochIdCounter % epochsInADay == 1 && epochIdCounter > 1) {
            dayCounter += 1;
            DAY_STARTED = true;

            emit DayStartedEvent(dayCounter, block.timestamp);
        }

        EPOCH_RELEASED = true;
        emit EpochReleased(epochIdCounter, begin, end, block.timestamp);

        return (DAY_STARTED, EPOCH_RELEASED);
    }

    /**
     * @dev Loads slot submissions for a specific day
     * @param slotId The slot ID
     * @param dayId The day ID
     * @param snapshotCount The number of snapshots submitted
     */
    function loadSlotSubmissions(
        uint256 slotId,
        uint256 dayId,
        uint256 snapshotCount,
        address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        slotSubmissionCount[slotId][dayId] = snapshotCount;
    }

    /**
     * @dev Loads the current day counter
     * @param _dayCounter The new day counter value
     */
    function loadCurrentDay(uint256 _dayCounter, address _sender) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        dayCounter = _dayCounter;
    }

    /**
     * @dev Updates the minimum number of attestations required for consensus
     * @param _minAttestationsForConsensus The new minimum value
     */
    function updateMinAttestationsForConsensus(
        uint256 _minAttestationsForConsensus,
        address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(_minAttestationsForConsensus != 0, "E45");
        minAttestationsForConsensus = _minAttestationsForConsensus;
    }

    /**
     * @dev Updates the batch submission window
     * @param newbatchSubmissionWindow The new batch submission window
     */
    function updateBatchSubmissionWindow(
        uint256 newbatchSubmissionWindow,
        address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(newbatchSubmissionWindow > snapshotSubmissionWindow, "E41");
        require(newbatchSubmissionWindow != 0, "E45");
        batchSubmissionWindow = newbatchSubmissionWindow;
    }

    /**
     * @dev Updates the snapshot submission window
     * @param newsnapshotSubmissionWindow The new snapshot submission window
     */
    function updateSnapshotSubmissionWindow(
        uint256 newsnapshotSubmissionWindow,
        address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(newsnapshotSubmissionWindow != 0, "E45");
        snapshotSubmissionWindow = newsnapshotSubmissionWindow;
    }

    /**
     * @dev Updates the attestation submission window
     * @param newattestationSubmissionWindow The new attestation submission window
     */
    function updateAttestationSubmissionWindow(
        uint256 newattestationSubmissionWindow,
        address _sender
    ) public onlyProtocolState {
        require(isOwner(_sender), "E03");
        require(newattestationSubmissionWindow > batchSubmissionWindow && batchSubmissionWindow > 0, "E42");
        require(newattestationSubmissionWindow != 0, "E45");
        attestationSubmissionWindow = newattestationSubmissionWindow;
    }

    /**
     * @dev Releases a new epoch
     * @param begin The beginning block number of the new epoch
     * @param end The ending block number of the new epoch
     * @return DAY_STARTED Boolean indicating if a new day has started
     * @return EPOCH_RELEASED Boolean indicating if the epoch was successfully released
     */
    function releaseEpoch(
        uint256 begin,
        uint256 end,
        address _sender
    ) public isActive onlyProtocolState returns (bool, bool) {
        require(isEpochManager(_sender), "E05");
        bool DAY_STARTED = false;
        bool EPOCH_RELEASED = false;
        require(end >= begin, "E20");
        require(end - begin + 1 == EPOCH_SIZE, "E21");
        if (currentEpoch.begin > 0) {
            require(currentEpoch.end + 1 == begin, "E22");
        }
        if (EPOCH_SIZE == 1 && USE_BLOCK_NUMBER_AS_EPOCH_ID) {
            epochIdCounter = end;
        } else {
            epochIdCounter += 1;
        }

        // Check if a new day has started
        if (epochIdCounter % epochsInADay == 1 && epochIdCounter > 1) {
            dayCounter += 1;
            DAY_STARTED = true;
            emit DayStartedEvent(dayCounter, block.timestamp);
        }

        currentEpoch = Epoch(begin, end, epochIdCounter);
        epochInfo[epochIdCounter] = EpochInfo(
            block.timestamp,
            block.number,
            end
        );

        EPOCH_RELEASED = true;
        emit EpochReleased(epochIdCounter, begin, end, block.timestamp);

        return (DAY_STARTED, EPOCH_RELEASED);
    }

    /**
     * @dev Retrieves the list of validators
     * @return An array of validator addresses
     */
    function getValidators() public view returns (address[] memory) {
        return validatorSet.values();
    }

    /**
     * @dev Retrieves the list of sequencers
     * @return An array of sequencer addresses
     */
    function getSequencers() public view returns (address[] memory) {
        return sequencerSet.values();
    }

    /**
     * @dev Retrieves the list of admins
     * @return An array of admin addresses
     */
    function getAdmins() public view returns (address[] memory) {
        return adminSet.values();
    }

    /**
     * @dev Retrieves the epoch manager address
     * @return The address of the epoch manager
     */
    function getEpochManager() public view returns (address) {
        return epochManager;
    }

    /**
     * @dev Retrieves information about a specific slot
     * @param slotId The ID of the slot to query
     * @return SlotInfo struct containing slot information
     */
    function getSlotInfo(uint256 slotId) public view returns (SlotInfo memory) {
        ISnapshotterState snapshotterState = protocolState.snapshotterState();

        address snapshotterAddress = snapshotterState.nodeSnapshotterMapping(
            slotId
        );
        uint256 rewardPoints = slotRewardPoints[slotId];
        uint256 currentDaySnapshotCount = slotSubmissionCount[slotId][
            dayCounter
        ];

        return
            SlotInfo(
                slotId,
                snapshotterAddress,
                rewardPoints,
                currentDaySnapshotCount
            );
    }

    /**
     * @dev Checks if a slot has completed its daily task
     * @param slotId The ID of the slot to check
     * @param day The day to check
     * @return Boolean indicating if the daily task is completed
     */
    function checkSlotTaskStatusForDay(
        uint256 slotId,
        uint256 day
    ) public view returns (bool) {
        return slotSubmissionCount[slotId][day] >= dailySnapshotQuota;
    }

    /**
     * @dev Retrieves the total number of snapshotters
     * @return The total number of snapshotters
     */
    function getTotalSnapshotterCount() public view returns (uint256) {
        // NOTE: will be changed to individual data market assigned snapshotter count later
        ISnapshotterState snapshotterState = protocolState.snapshotterState();
        return snapshotterState.getTotalSnapshotterCount();
    }

    /**
     * @dev Retrieves the total number of validators
     * @return The total number of validators
     */
    function getTotalValidatorsCount() public view returns (uint256) {
        return validatorSet.length();
    }

    /**
     * @dev Retrieves the total number of sequencers
     * @return The total number of sequencers
     */
    function getTotalSequencersCount() public view returns (uint256) {
        return sequencerSet.length();
    }

    /**
     * @dev Retrieves the snapshot CID with the maximum consensus for a given project and epoch
     * @param projectId The ID of the project
     * @param epochId The ID of the epoch
     * @return The snapshot CID with maximum consensus, or an empty string if not found
     */
    function maxSnapshotsCid(
        string memory projectId,
        uint256 epochId
    ) public view returns (string memory, SnapshotStatus) {
        string memory cid = snapshotStatus[projectId][epochId].snapshotCid;
        if (bytes(cid).length > 0) {
            return (cid, snapshotStatus[projectId][epochId].status);
        }
        return ("", SnapshotStatus.PENDING);
    }

    /**
     * @dev Allows a sequencer to submit a batch of snapshots for a given epoch
     * @param batchCid IPFS CID of the batch (unique ID for a batch)
     * @param epochId Epoch ID
     * @param projectIds Array of project IDs contained in the batch
     * @param snapshotCids Array of trusted finalization of IPFS CIDs as reported by the sequencer
     * @param finalizedCidsRootHash Root hash of the merkle tree constructed from the finalized CIDs
     * @return SNAPSHOT_BATCH_SUBMITTED Boolean indicating if the batch was submitted successfully
     * @return DELAYED_BATCH_SUBMITTED Boolean indicating if the batch was submitted after the submission window
     */
    function submitSubmissionBatch(
        string memory batchCid,
        uint256 epochId,
        string[] memory projectIds,
        string[] memory snapshotCids,
        bytes32 finalizedCidsRootHash,
        address _sender
    ) public onlyProtocolState returns (bool SNAPSHOT_BATCH_SUBMITTED, bool DELAYED_BATCH_SUBMITTED) {
        require(isSequencer(_sender), "E04");
        if (
            block.number <=
            epochInfo[epochId].blocknumber + batchSubmissionWindow
        ) {
            require(
                projectIds.length == snapshotCids.length,
                "E23"
            );
            require(
                projectIds.length > 0,
                "E24"
            );
            require(
                !epochIdToBatchSubmissionsCompleted[epochId],
                "E43"
            );
            if (batchCidToProjects[batchCid].length > 0) {
                delete batchCidToProjects[batchCid];
            }

            for (uint i = 0; i < projectIds.length; i++) {
                require(
                    snapshotStatus[projectIds[i]][epochId].timestamp == 0,
                    "E25"
                );
                snapshotStatus[projectIds[i]][epochId].status = SnapshotStatus.PENDING;
                snapshotStatus[projectIds[i]][epochId].snapshotCid = snapshotCids[i];
                snapshotStatus[projectIds[i]][epochId].timestamp = block.timestamp;
                // setting projectFirstEpochId before batch attestation
                if (projectFirstEpochId[projectIds[i]] == 0) {
                    projectFirstEpochId[projectIds[i]] = epochId;
                }
                lastSequencerFinalizedSnapshot[projectIds[i]] = epochId;
                batchCidToProjects[batchCid].push(projectIds[i]);
            }
            epochIdToBatchCids[epochId].push(batchCid);
            batchCidSequencerAttestation[batchCid] = finalizedCidsRootHash;
            SNAPSHOT_BATCH_SUBMITTED = true;
            emit SnapshotBatchSubmitted(
                batchCid,
                epochId,
                block.timestamp
            );
        } else {
            DELAYED_BATCH_SUBMITTED = true;
            emit DelayedBatchSubmitted(
                batchCid,
                epochId,
                block.timestamp
            );
        }
    }

    /**
     * @dev Retrieves the number of divergent validators for a given batch CID
     * @param batchCid The batch CID to query
     * @return The number of divergent validators
     */
    function batchCidDivergentValidatorsLen(
        string memory batchCid
    ) public view returns (uint256) {
        return batchCidDivergentValidators[batchCid].length;
    }

    /**
     * @dev Retrieves the number of projects in a batch
     * @param batchCid The batch CID to query
     * @return The number of projects in the batch
     */
    function batchCidToProjectsLen(
        string memory batchCid
    ) public view returns (uint256) {
        return batchCidToProjects[batchCid].length;
    }

    /**
     * @dev Marks batch submissions as completed for a given epoch
     * @param epochId The epoch ID to mark as completed
     */
    function endBatchSubmissions(uint256 epochId, address _sender) external {
        require(isSequencer(_sender), "E04");
        require(!epochIdToBatchSubmissionsCompleted[epochId], "E39");
        epochIdToBatchSubmissionsCompleted[epochId] = true;
        emit BatchSubmissionsCompleted(epochId, block.timestamp);
    }

    /**
     * @dev Allows a validator to submit an attestation for a batch
     * @param batchCid The batch CID to attest
     * @param epochId The epoch ID of the batch
     * @param finalizedCidsRootHash The root hash of the merkle tree constructed from the finalized CIDs
     * @return SNAPSHOT_BATCH_ATTESTATION_SUBMITTED Boolean indicating if the attestation was submitted successfully
     */
    function submitBatchAttestation(
        string memory batchCid,
        uint256 epochId,
        bytes32 finalizedCidsRootHash,
        address _sender
    ) public onlyProtocolState returns (bool SNAPSHOT_BATCH_ATTESTATION_SUBMITTED){
        require(isValidator(_sender), "E01");
        bool found = false;
        for (uint i = 0; i < epochIdToBatchCids[epochId].length; i++) {
            string memory curBatchCid = epochIdToBatchCids[epochId][i];
            if (keccak256(abi.encodePacked(curBatchCid)) == keccak256(abi.encodePacked(batchCid))) {
                found = true;
                break;
            }
        }
        require(found == true, "E26");
        require(!validatorAttestationsReceived[tx.origin][epochId][batchCid], "E40");
        if (
            block.number <=
            epochInfo[epochId].blocknumber + attestationSubmissionWindow
        ) {
            attestationsReceivedCount[batchCid][finalizedCidsRootHash] += 1;
            uint256 currentAttestationCount = attestationsReceivedCount[
                batchCid
            ][finalizedCidsRootHash];
            uint256 maxAttestationCount = maxAttestationsCount[batchCid];

            if (currentAttestationCount >= maxAttestationCount) {
                maxAttestationFinalizedRootHash[
                    batchCid
                ] = currentAttestationCount == maxAttestationCount
                    ? bytes32(0)
                    : bytes32(finalizedCidsRootHash);
                maxAttestationsCount[batchCid] = currentAttestationCount;
            }
            if (finalizedCidsRootHash != batchCidSequencerAttestation[batchCid]) {
                batchCidDivergentValidators[batchCid].push(tx.origin);
            }
            if (
                shouldFinalizeBatchAttestation(batchCid, currentAttestationCount)
            ) {
                finalizeSnapshotBatch(batchCid, epochId);
            }
            attestationsReceived[batchCid][tx.origin] = true;
            SNAPSHOT_BATCH_ATTESTATION_SUBMITTED = true;
            emit SnapshotBatchAttestationSubmitted(
                batchCid,
                epochId,
                block.timestamp,
                tx.origin
            );
            validatorAttestationsReceived[tx.origin][epochId][batchCid] = true;
        } else {
            attestationsReceived[batchCid][tx.origin] = true;
            emit DelayedAttestationSubmitted(
                batchCid,
                epochId,
                block.timestamp,
                tx.origin
            );
        }
    }

    /**
     * @dev Checks if a batch attestation should be finalized
     * @param batchCid The batch CID to check
     * @param currentAttestationCount The current number of attestations for the batch
     * @return Boolean indicating if the batch attestation should be finalized
     */
    function shouldFinalizeBatchAttestation(
        string memory batchCid,
        uint256 currentAttestationCount
    ) private view returns (bool) {
        return
            !batchCidAttestationStatus[batchCid] &&
            currentAttestationCount * 10 >
            (getTotalValidatorsCount() * 10) / 2 &&
            maxAttestationsCount[batchCid] >= minAttestationsForConsensus;
    }

    /**
     * @dev Finalizes a snapshot batch based on validator attestations
     * @param batchCid The batch CID to finalize
     * @param epochId The epoch ID of the batch
     * @return TRIGGER_BATCH_RESUBMISSION Boolean indicating if batch resubmission should be triggered
     */
    function finalizeSnapshotBatch(string memory batchCid, uint256 epochId) private
    returns(
        bool TRIGGER_BATCH_RESUBMISSION, 
        bool BATCH_FINALIZED
    ) {
        if (
            maxAttestationFinalizedRootHash[batchCid] ==
            batchCidSequencerAttestation[batchCid]
        ) {
            for (
                uint i = 0;
                i < batchCidDivergentValidators[batchCid].length;
                i++
            ) {
                emit ValidatorAttestationsInvalidated(
                    epochId,
                    batchCid,
                    batchCidDivergentValidators[batchCid][i],
                    block.timestamp
                );
            }
            batchCidAttestationStatus[batchCid] = true;
            string[] memory batchProjects = batchCidToProjects[batchCid];
            for (uint j = 0; j < batchProjects.length; j++) {
                string memory projectCid = snapshotStatus[batchProjects[j]][epochId].snapshotCid;
                if (bytes(projectCid).length > 0) {
                    snapshotStatus[batchProjects[j]][epochId].status = SnapshotStatus.FINALIZED;
                    snapshotStatus[batchProjects[j]][epochId].timestamp = block.timestamp;
                    lastFinalizedSnapshot[batchProjects[j]] = epochId;
                    if (projectFirstEpochId[batchProjects[j]] == 0) {
                        projectFirstEpochId[batchProjects[j]] = epochId;
                    }
                    emit SnapshotFinalized(
                        epochId,
                        epochInfo[epochId].epochEnd,
                        batchProjects[j],
                        snapshotStatus[batchProjects[j]][epochId].snapshotCid,
                        block.timestamp
                    );
                }
            }
            BATCH_FINALIZED = true;
            emit SnapshotBatchFinalized(epochId, batchCid, block.timestamp);
        } else {
            TRIGGER_BATCH_RESUBMISSION = true;
            emit TriggerBatchResubmission(epochId, batchCid, block.timestamp);
        }
    }

    /**
     * @dev Forces completion of consensus attestations for a batch
     * @param batchCid The batch CID to force complete
     * @param epochId The epoch ID of the batch
     * @return TRIGGER_BATCH_RESUBMISSION Boolean indicating if batch resubmission should be triggered
     */
    function forceCompleteConsensusAttestations(
        string memory batchCid,
        uint256 epochId,
        address _sender
    ) public onlyProtocolState returns (
        bool TRIGGER_BATCH_RESUBMISSION, bool BATCH_FINALIZED
    ) {
        require(isOwner(_sender), "E03");
        if (checkDynamicConsensusAttestations(batchCid, epochId)) {
            (TRIGGER_BATCH_RESUBMISSION, BATCH_FINALIZED) = finalizeSnapshotBatch(batchCid, epochId);
        }
        else{
            TRIGGER_BATCH_RESUBMISSION = true;
            emit TriggerBatchResubmission(epochId, batchCid, block.timestamp);
        }
    }

    /**
     * @dev Checks if dynamic consensus attestations are complete for a batch
     * @param batchCid The batch CID to check
     * @param epochId The epoch ID of the batch
     * @return Boolean indicating if dynamic consensus attestations are complete
     */
    function checkDynamicConsensusAttestations(
        string memory batchCid,
        uint256 epochId
    ) public view returns (bool) {
        if (
            !batchCidAttestationStatus[batchCid] &&
            epochInfo[epochId].blocknumber + attestationSubmissionWindow <
            block.number &&
            maxAttestationsCount[batchCid] >= minAttestationsForConsensus &&
            bytes32(maxAttestationFinalizedRootHash[batchCid]) != bytes32(0)
        ) {
            return true;
        }
        return false;
    }

    function updateEligibleNodesForDay(uint256 day, uint256 eligibleNodes, address _sender) public onlyProtocolState {
        require(isSequencer(_sender), "E04");
        if (eligibleNodesForDay[day] != 0) {
            return;
        }
        eligibleNodesForDay[day] = eligibleNodes;
    }

    function updateRewards(uint256 slotId, uint256 submissions, uint256 day, address _sender) public onlyProtocolState returns (bool) {
        require(isSequencer(_sender), "E04");
        require(day == dayCounter || day == dayCounter - 1, "E38");
        ISnapshotterState snapshotterState = protocolState
            .snapshotterState();

        bool isNodeAvailable = snapshotterState.isNodeAvailable(slotId);
        // continue if node is not available
        if (!isNodeAvailable) {
            return false;
        }
        address snapshotterAddr = snapshotterState.nodeSnapshotterMapping(
            slotId
        );

        slotSubmissionCount[slotId][day] = submissions;
        if (submissions >= dailySnapshotQuota) {
            if (eligibleNodesForDay[day] != 0){
                slotRewardPoints[slotId] += rewardPoolSize / eligibleNodesForDay[day];
                emit RewardsDistributedEvent(
                    snapshotterAddr,
                    slotId,
                    day,
                    rewardPoolSize / eligibleNodesForDay[day],
                    block.timestamp
                );
            }
            emit DailyTaskCompletedEvent(
                snapshotterAddr,
                slotId,
                day,
                block.timestamp
            );
            return true;
        }
        return false;
    }

}

# PowerloomDataMarket Smart Contract Documentation

## Table of Contents
- [PowerloomDataMarket Smart Contract Documentation](#powerloomdatamarket-smart-contract-documentation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Architecture](#architecture)
    - [Core Components](#core-components)
    - [Key Roles](#key-roles)
    - [Dependencies](#dependencies)
  - [Contract Components](#contract-components)
    - [State Variables](#state-variables)
      - [Configuration Parameters](#configuration-parameters)
      - [Time Windows](#time-windows)
      - [Operational State](#operational-state)
    - [Data Structures](#data-structures)
      - [Epoch](#epoch)
      - [ConsensusStatus](#consensusstatus)
      - [SlotInfo](#slotinfo)
    - [Events](#events)
      - [Epoch Management](#epoch-management)
      - [Snapshot Operations](#snapshot-operations)
      - [Reward System](#reward-system)
      - [Administrative](#administrative)
  - [State Transitions](#state-transitions)
    - [Snapshot Lifecycle](#snapshot-lifecycle)
    - [Epoch Lifecycle](#epoch-lifecycle)
  - [Security Model](#security-model)
    - [Access Control](#access-control)
    - [Consensus Mechanism](#consensus-mechanism)
  - [Technical Details](#technical-details)
    - [State Variables Reference](#state-variables-reference)
      - [Configuration State](#configuration-state)
      - [Time Window State](#time-window-state)
      - [Operational State](#operational-state-1)
    - [Mappings Reference](#mappings-reference)
      - [Consensus Mappings](#consensus-mappings)
      - [Snapshot Mappings](#snapshot-mappings)
    - [Functions Reference](#functions-reference)
      - [Initialization Functions](#initialization-functions)
      - [Epoch Management Functions](#epoch-management-functions)
      - [Snapshot Operations Functions](#snapshot-operations-functions)
      - [Reward System Functions](#reward-system-functions)
    - [Access Control Functions](#access-control-functions)
    - [Query Functions](#query-functions)
    - [Modifiers](#modifiers)
    - [Access Control Matrix](#access-control-matrix)

## Overview
The PowerloomDataMarket contract is a core component of the Powerloom Protocol that manages data market operations. It implements a comprehensive system for epoch management, snapshot submissions, validator attestations, and reward distribution. The contract ensures data integrity through a consensus mechanism and provides incentives for network participants.

## Architecture
As Explained in the [Overview](../../README.md#unified-view-and-interface-for-all-peers), all the data market functions and state variables are accessible through the [ProtocolState](../contracts/ProtocolState.sol) contract.

### Core Components
1. **Epoch Management**: Handles time-based data collection periods
2. **Snapshot System**: Manages data snapshots submitted by network participants
3. **Consensus Mechanism**: Validates data through validator attestations
4. **Reward System**: Distributes rewards to participants based on their contributions

### Key Roles
- **Owner**: Contract administrator with privileged access
- **Validators**: Network participants who validate snapshots
- **Sequencers**: Entities responsible for submitting snapshot batches
- **Admins**: Additional administrators with specific permissions
- **Snapshotters**: Network nodes that submit snapshots

### Dependencies
- OpenZeppelin's `Ownable` contract for access control
- OpenZeppelin's `EnumerableSet` library for efficient set operations
- External protocol state and snapshotter state interfaces

## Contract Components

### State Variables

#### Configuration Parameters
- `rewardPoolSize`: Total reward pool size (1,000,000e18) by default but can be changed by the owner
- `dailySnapshotQuota`: Required snapshots per day (1000) by default but can be changed by the owner
- `EPOCH_SIZE`: Blocks per epoch
- `SOURCE_CHAIN_ID`: Source chain identifier
- `SOURCE_CHAIN_BLOCK_TIME`: Block time (seconds * 1e4)
- `DAY_SIZE`: Seconds per day with 1e4 precision (864000000)
- `minAttestationsForConsensus`: Minimum attestations for consensus (2)

#### Time Windows
- `snapshotSubmissionWindow`: Snapshot submission period
- `batchSubmissionWindow`: Batch submission period
- `attestationSubmissionWindow`: Attestation submission period

#### Operational State
- `isInitialized`: Initialization status
- `rewardsEnabled`: Reward system status
- `currentEpoch`: Current epoch information
- `dayCounter`: Current day tracking
- `epochIdCounter`: Current epoch ID
- `epochsInADay`: Epochs per day calculation

### Data Structures

#### Epoch
```solidity
struct Epoch {
    uint256 begin;
    uint256 end;
    uint256 epochId;
}
```

#### ConsensusStatus
```solidity
struct ConsensusStatus {
    SnapshotStatus status;
    string snapshotCid;
    uint256 timestamp;
}
```

#### SlotInfo
```solidity
struct SlotInfo {
    uint256 slotId;
    address snapshotterAddress;
    uint256 rewardPoints;
    uint256 currentDaySnapshotCount;
}
```

### Events

#### Epoch Management
- `EpochReleased(uint256 indexed epochId, uint256 begin, uint256 end, uint256 timestamp)`
  - Purpose: Signals new epoch creation
  - Usage: External systems track epoch progression

- `DayStartedEvent(uint256 dayId, uint256 timestamp)`
  - Purpose: Signals start of new day
  - Usage: Tracking daily reward cycles

#### Snapshot Operations
- `SnapshotBatchSubmitted(string batchCid, uint256 indexed epochId, uint256 timestamp)`
- `SnapshotBatchAttestationSubmitted(string batchCid, uint256 indexed epochId, uint256 timestamp, address indexed validatorAddr)`
- `SnapshotBatchFinalized(uint256 indexed epochId, string batchCid, uint256 timestamp)`
- `SnapshotFinalized(uint256 indexed epochId, uint256 epochEnd, string projectId, string snapshotCid, uint256 timestamp)`

#### Reward System
- `DailyTaskCompletedEvent(address snapshotterAddress, uint256 slotId, uint256 dayId, uint256 timestamp)`
- `RewardsDistributedEvent(address snapshotterAddress, uint256 slotId, uint256 dayId, uint256 rewardPoints, uint256 timestamp)`

#### Administrative
- `ValidatorsUpdated(address validatorAddress, bool allowed)`
- `SequencersUpdated(address sequencerAddress, bool allowed)`
- `AdminsUpdated(address adminAddress, bool allowed)`

## State Transitions

### Snapshot Lifecycle
1. **Submission**: Sequencer submits batch of snapshots
2. **Attestation**: Validators attest to the batch
3. **Consensus**: Batch reaches minimum attestations
4. **Finalization**: Batch is finalized
5. **Rewards Distribution**: Rewards are distributed to snapshotters at the end of the day

### Epoch Lifecycle
1. **Creation**: New epoch released
2. **Active**: Accepts snapshot submissions
3. **Submission Window**: Validators attest to snapshots
4. **Finalization**: Epoch completed and next epoch begins


## Security Model

### Access Control
- Role-based access through modifiers
- Separate validator and sequencer sets
- Admin capabilities for emergency control

### Consensus Mechanism
- Minimum attestation threshold prevents small validator attacks
- Majority consensus requirement
- Time windows prevent late submissions/attestations

## Technical Details

### State Variables Reference

#### Configuration State
```solidity
uint256 public rewardPoolSize = 1_000_000e18;
uint256 public dailySnapshotQuota = 50;
uint8 public EPOCH_SIZE;
uint256 public SOURCE_CHAIN_ID;
uint256 public SOURCE_CHAIN_BLOCK_TIME;
uint256 public DAY_SIZE = 864000000;
uint256 public minAttestationsForConsensus = 2;
```

These variables define the core configuration of the contract:
- `rewardPoolSize`: Maximum rewards available for distribution (1 million tokens)
- `dailySnapshotQuota`: Number of snapshots required per day for reward eligibility
- `EPOCH_SIZE`: Number of blocks in an epoch, set during initialization
- `SOURCE_CHAIN_ID`: Identifier of the chain being monitored
- `SOURCE_CHAIN_BLOCK_TIME`: Block time in seconds * 1e4 for precision
- `DAY_SIZE`: Number of blocks in a day (default: 864000000)
- `minAttestationsForConsensus`: Minimum validator attestations needed for consensus

#### Time Window State
```solidity
uint256 public snapshotSubmissionWindow = 1;
uint256 public batchSubmissionWindow = 1;
uint256 public attestationSubmissionWindow = 1;
```

Time windows control the submission periods:
- `snapshotSubmissionWindow`: Blocks allowed for snapshot submission after epoch start
- `batchSubmissionWindow`: Blocks allowed for batch submission
- `attestationSubmissionWindow`: Blocks allowed for attestation submission

#### Operational State
```solidity
string public sequencerId;
IPowerloomProtocolState public protocolState;
Epoch public currentEpoch;
uint256 public dayCounter = 1;
uint256 public epochIdCounter = 0;
address public epochManager;
bool public isInitialized = false;
uint256 public deploymentBlockNumber;
bool public USE_BLOCK_NUMBER_AS_EPOCH_ID;
bool public rewardsEnabled = true;
```

These variables track the operational state:
- `sequencerId`: Identifier for the current sequencer
- `protocolState`: Interface to the protocol state contract
- `currentEpoch`: Current epoch information (begin, end, id)
- `dayCounter`: Current day number
- `epochIdCounter`: Current epoch ID
- `epochManager`: Address authorized to manage epochs
- `isInitialized`: Contract initialization status
- `deploymentBlockNumber`: Block number at contract deployment
- `USE_BLOCK_NUMBER_AS_EPOCH_ID`: Flag for epoch ID calculation method
- `rewardsEnabled`: Controls reward distribution

### Mappings Reference

#### Consensus Mappings
```solidity
mapping(uint256 => EpochInfo) public epochInfo;
mapping(string => string[]) public batchCidToProjects;
mapping(uint256 => string[]) public epochIdToBatchCids;
mapping(string => mapping(address => bool)) public attestationsReceived;
mapping(string => mapping(bytes32 => uint256)) public attestationsReceivedCount;
```

Consensus-related mappings:
- `epochInfo`: Stores epoch information (timestamp, block number, end)
- `batchCidToProjects`: Links batch CIDs to their project IDs
- `epochIdToBatchCids`: Links epoch IDs to their batch CIDs
- `attestationsReceived`: Tracks validator attestations per batch
- `attestationsReceivedCount`: Counts attestations per finalized root hash

#### Snapshot Mappings
```solidity
mapping(string => mapping(uint256 => ConsensusStatus)) public snapshotStatus;
mapping(string => uint256) public lastFinalizedSnapshot;
mapping(string => uint256) public lastSequencerFinalizedSnapshot;
mapping(string => uint256) public projectFirstEpochId;
```

Snapshot-related mappings:
- `snapshotStatus`: Tracks consensus status for project snapshots
- `lastFinalizedSnapshot`: Last finalized epoch ID per project
- `lastSequencerFinalizedSnapshot`: Last sequencer-finalized epoch ID per project
- `projectFirstEpochId`: First epoch ID for each project

### Functions Reference

#### Initialization Functions

```solidity
function initialize(
    address ownerAddress,
    uint8 epochSize,
    uint256 sourceChainId,
    uint256 sourceChainBlockTime,
    bool useBlockNumberAsEpochId,
    address _protocolStateAddress
) external onlyOwner
```
Initializes the contract with core parameters:
- Requirements:
  - Contract must not be initialized
  - Only owner can call
- Parameters:
  - `ownerAddress`: Address to transfer ownership to
  - `epochSize`: Number of blocks per epoch
  - `sourceChainId`: Chain ID being monitored
  - `sourceChainBlockTime`: Block time of source chain
  - `useBlockNumberAsEpochId`: Epoch ID calculation method
  - `_protocolStateAddress`: Protocol state contract address
- Effects:
  - Sets initial configuration
  - Transfers ownership
  - Marks contract as initialized

#### Epoch Management Functions

```solidity
function releaseEpoch(uint256 begin, uint256 end) 
    public 
    onlyEpochManager 
    isActive 
    returns (bool, bool)
```
Creates a new epoch:
- Requirements:
  - Only epoch manager can call
  - Contract must be active
  - Valid epoch boundaries
- Parameters:
  - `begin`: Starting block number
  - `end`: Ending block number
- Returns:
  - Boolean tuple: (day started, epoch released)
- Effects:
  - Creates new epoch
  - Updates day counter if needed
  - Emits events

```solidity
function forceSkipEpoch(uint256 begin, uint256 end)
    public 
    onlyOwnerOrigin 
    isActive
```
Administrative function to skip epochs:
- Requirements:
  - Only owner can call
  - Contract must be active
  - Valid epoch boundaries
- Parameters:
  - `begin`: New epoch start
  - `end`: New epoch end
- Effects:
  - Forces epoch progression
  - Updates counters
  - Emits events

#### Snapshot Operations Functions

```solidity
function submitSubmissionBatch(
    string memory batchCid,
    uint256 epochId,
    string[] memory projectIds,
    string[] memory snapshotCids,
    bytes32 finalizedCidsRootHash
) public onlySequencer returns (bool, bool)
```
Submits batch of snapshots:
- Requirements:
  - Only sequencer can call
  - Within submission window
  - Valid arrays
- Parameters:
  - `batchCid`: Unique batch identifier
  - `epochId`: Target epoch
  - `projectIds`: Projects in batch
  - `snapshotCids`: Snapshot CIDs
  - `finalizedCidsRootHash`: Root hash of finalized CIDs
- Returns:
  - Boolean tuple: (batch submitted, delayed submission)
- Effects:
  - Records submissions
  - Updates status
  - Emits events

```solidity
function submitBatchAttestation(
    string memory batchCid,
    uint256 epochId,
    bytes32 finalizedCidsRootHash
) public onlyValidator returns (bool)
```
Validates submitted snapshots:
- Requirements:
  - Only validator can call
  - Within attestation window
  - Valid batch
- Parameters:
  - `batchCid`: Batch to attest
  - `epochId`: Target epoch
  - `finalizedCidsRootHash`: Root hash to verify
- Returns:
  - Boolean: attestation submitted
- Effects:
  - Records attestation
  - Updates consensus
  - May trigger finalization
  - Emits events

#### Reward System Functions

```solidity
function updateRewards(
    uint256 slotId,
    uint256 submissions,
    uint256 day
) public onlySequencer returns (bool)
```
Updates rewards for snapshotter nodes:
- Requirements:
  - Only sequencer can call
  - Valid day
  - Node must be available
- Parameters:
  - `slotId`: Target slot
  - `submissions`: Number of submissions
  - `day`: Target day
- Returns:
  - Boolean: rewards updated
- Effects:
  - Updates submission counts
  - Distributes rewards if quota met
  - Emits events

### Access Control Functions

```solidity
function updateAddresses(
    Role role,
    address[] calldata _addresses,
    bool[] calldata _status
) external onlyOwnerOrigin returns (Role)
```
Manages validator, sequencer, and admin sets:
- Requirements:
  - Only owner can call
  - Arrays must match length
- Parameters:
  - `role`: Role to update (VALIDATOR/SEQUENCER/ADMIN)
  - `_addresses`: Addresses to update
  - `_status`: New status for each address
- Returns:
  - Role: updated role
- Effects:
  - Updates role memberships
  - Emits events

### Query Functions

```solidity
function getSlotInfo(uint256 slotId) 
    public 
    view 
    returns (SlotInfo memory)
```
Retrieves slot information:
- Parameters:
  - `slotId`: Target slot
- Returns:
  - SlotInfo struct with:
    - Snapshotter address
    - Reward points
    - Daily snapshot count

```solidity
function checkSlotTaskStatusForDay(
    uint256 slotId,
    uint256 day
) public view returns (bool)
```
Checks if slot completed daily quota:
- Parameters:
  - `slotId`: Target slot
  - `day`: Target day
- Returns:
  - Boolean: quota met

### Modifiers

```solidity
modifier onlyValidator()
modifier onlySequencer()
modifier onlyOwnerOrigin()
modifier onlyEpochManager()
modifier onlyOwnerOrAdmin()
modifier isActive()
```

Access control modifiers:
- `onlyValidator`: Restricts to validated validators
- `onlySequencer`: Restricts to registered sequencers
- `onlyOwnerOrigin`: Restricts to contract owner
- `onlyEpochManager`: Restricts to epoch manager
- `onlyOwnerOrAdmin`: Restricts to owner or admins
- `isActive`: Checks if contract is enabled

### Access Control Matrix

| Function               | Owner | Admin | Validator | Sequencer | EpochManager |
|-----------------------|-------|-------|-----------|-----------|--------------|
| initialize            | ✓     | -     | -         | -         | -            |
| releaseEpoch          | -     | -     | -         | -         | ✓            |
| submitSubmissionBatch | -     | -     | -         | ✓         | -            |
| submitBatchAttestation| -     | -     | ✓         | -         | -            |
| updateRewards         | -     | -     | -         | ✓         | -            |
| updateAddresses       | ✓     | -     | -         | -         | -            |

# Powerloom Protocol Contracts

## Table of Contents
- [Powerloom Protocol Contracts](#powerloom-protocol-contracts)
  - [Table of Contents](#table-of-contents)
  - [Overview: Smart Contract Architecture](#overview-smart-contract-architecture)
    - [Unified view and interface for all peers](#unified-view-and-interface-for-all-peers)
    - [Data markets](#data-markets)
    - [Identity management](#identity-management)
      - [Snapshotters](#snapshotters)
  - [State transitions](#state-transitions)
    - [Snapshot state](#snapshot-state)
  - [State modification: Data market contracts](#state-modification-data-market-contracts)
    - [Update 'day' size](#update-day-size)
    - [Rewards distribution](#rewards-distribution)
      - [Toggle rewards distribution](#toggle-rewards-distribution)
      - [Daily snapshot quota](#daily-snapshot-quota)
      - [Commit submission counts](#commit-submission-counts)
    - [Epochs](#epochs)
      - [Epoch release](#epoch-release)
      - [Skip epochs](#skip-epochs)
    - [Snapshot submission in batches by sequencer](#snapshot-submission-in-batches-by-sequencer)
    - [Indicating end of batch submissions for an epoch](#indicating-end-of-batch-submissions-for-an-epoch)
    - [Attestation against submission batches by validator](#attestation-against-submission-batches-by-validator)
    - [Finalization against attestation consensus](#finalization-against-attestation-consensus)
    - [Triggering attestation consensus externally](#triggering-attestation-consensus-externally)
  - [State view: Data market contracts](#state-view-data-market-contracts)
    - [Epoch size](#epoch-size)
    - [Data source chain properties](#data-source-chain-properties)
    - [Consensus properties](#consensus-properties)
    - [Status and CIDs of snapshots](#status-and-cids-of-snapshots)
    - [`batchCidToProjects`](#batchcidtoprojects)
    - [`epochIdToBatchCids`](#epochidtobatchcids)
    - [Validator attestations](#validator-attestations)
  - [State view: Snapshotter identity state contract](#state-view-snapshotter-identity-state-contract)
    - [`allSnapshotters(address)`](#allsnapshottersaddress)
    - [`slotSnapshotterMapping(uint256)`](#slotsnapshottermappinguint256)
    - [`slotCounter()`](#slotcounter)
  - [Events](#events)
    - [Namespaced event emissions](#namespaced-event-emissions)
      - [protocol state core contract](#protocol-state-core-contract)
      - [data market contract](#data-market-contract)
    - [Epoch related events](#epoch-related-events)
    - [Snapshot submissions](#snapshot-submissions)
    - [Validation](#validation)
    - [More details:](#more-details)

## Overview: Smart Contract Architecture

The smart contracts that maintain the protocol state are arranged as depicted in the diagram that follows.
The system is designed to be modular and extensible, with the ability to add new features as the protocol evolves. 

Main components and features are explained below:

### Unified view and interface for all peers
All the interactions with underlying data markets, their state changes and event emissions are accessible through the main [ProtocolState Contract](./hardhat/contracts/ProtocolState.sol).

- The Protocol State is a separate contract, managed by an UUPS upgradeable proxy
- [Snapshotter State contract](./hardhat/contracts/SnapshotterState.sol) is separate from the protocol state. It is used to maintain the state of snapshotters and their slots.

The upgradable proxy pattern allows for the core state contract to be upgraded without the need to redeploy the proxy and all the dependent contracts. 

The upgradable proxy pattern also allows for the state contract to be upgraded in a controlled manner, with the ability to maintain previous versions of the contract in case a regression is introduced in the new version

![Protocol V2 Smart Contract Architecture](./hardhat/docs/protocolV2-contract-state-dark.png) 

### Data markets

Data market contracts are separate from the protocol state. Their creation is initiated from the protocol state core contract and intermediated by a data market factory contract.

The following features of the protocol state are maintained in the data market contract since they are specific to their operations and functions:

* Epochs
  * Epoch release and epoch size
  * Epochs in a "day"
* Allowed sequencer identities
* Finalized snapshot CIDs against project IDs
* Submission counts against snapshotter slots
* Submission batches and their attestation consensus by validators


Read more about different components in our docs:
* [Sequencer](https://docs.powerloom.io/docs/Protocol/Protocol_v2/sequencer)
* [Validator](https://docs.powerloom.io/docs/Protocol/Protocol_v2/validator)
* [Data market](https://docs.powerloom.io/docs/Protocol/data-sources)
* [Snapshot composition](https://docs.powerloom.io/docs/Protocol/data-composition)


### Identity management

#### Snapshotters

Snapshotters are assigned slots on the protocol, and their identities are maintained on a separate `SnapshotterState` contract. The interface to interact with this contract is maintained in the protocol state contract as well as the data market contracts.

```solidity
/**
 * @title ISnapshotterState
 * @dev Interface for the SnapshotterState contract
 */
interface ISnapshotterState {
    /**
     * @dev Returns the snapshotter address for a given slot
     * @param slotId The ID of the slot
     * @return address of the snapshotter
     */
    function slotSnapshotterMapping(uint256 slotId) external view returns (address);

    /**
     * @dev Returns the total number of slots
     * @return uint256 representing the slot counter
     */
    function slotCounter() external view returns (uint256);

    /**
     * @dev Checks if an address is a registered snapshotter
     * @param snapshotter Address to check
     * @return bool indicating if the address is a snapshotter
     */
    function allSnapshotters(address snapshotter) external view returns (bool);
}
```

## State transitions

### Snapshot state

```solidity
enum SnapshotStatus {
    PENDING,
    FINALIZED
}
```
The state of a snapshot CID against a project ID is `PENDING` when reported by the sequencer and `FINALIZED` when the same is attested to by the validator.

The `PENDING` state can be considered to be an intermediate, trusted state since it is reported by the sequencer which has no incentive to be a bad actor unless its security is compromised.

---

## State modification: Data market contracts

### Update 'day' size

```solidity
function updateDaySize(uint256 _daySize) public onlyOwnerOrigin {
    DAY_SIZE = _daySize;
    epochsInADay = DAY_SIZE / (SOURCE_CHAIN_BLOCK_TIME * EPOCH_SIZE);
}
```

A 'day' for a data market is defined by the `DAY_SIZE` in seconds. The `epochsInADay` is the number of epochs that fit into a day.

### Rewards distribution

#### Toggle rewards distribution

```solidity
function toggleRewards() public onlyOwnerOrigin {
    rewardsEnabled = !rewardsEnabled;
}
```

#### Daily snapshot quota

This quota is the number of snapshots that have to be submitted by a snapshotter in a day to be eligible for rewards.

```solidity
function updateDailySnapshotQuota(
    uint256 _dailySnapshotQuota
) public onlyOwnerOrigin {
    dailySnapshotQuota = _dailySnapshotQuota;
}
```

#### Commit submission counts

The sequencer commits the submission counts for a day against the slot IDs of the snapshotters. It is planned to be decentralized in the future by combining the election of sequencers and reports on submitted counts peers called 'watchers'.

```solidity
function updateRewards(
    uint256[] memory slotIds,
    uint256[] memory submissionsList,
    uint256 day
) public onlySequencer returns (bool) {
```

Refer: [day size for a data market](#update-day-size)

### Epochs

#### Epoch release

```solidity
function releaseEpoch(
    uint256 begin,
    uint256 end
) public onlyEpochManager isActive returns (bool, bool) {
```

Refer: [Epoch manager](https://docs.powerloom.io/docs/Protocol/Specifications/Epoch)

#### Skip epochs

```solidity
function forceSkipEpoch(
    uint256 begin,
    uint256 end
) public onlyOwnerOrigin isActive {
```

This is a fallback mechanism to skip epochs in case the epoch release service fails.

### Snapshot submission in batches by [sequencer](https://docs.powerloom.io/docs/Protocol/Protocol_v2/sequencer)

```solidity
function submitSubmissionBatch(
        string memory batchCid,
        uint256 epochId,
        string[] memory projectIds,
        string[] memory snapshotCids,
        bytes32 finalizedCidsRootHash
    ) public onlySequencer
```

An epoch as identified by `epochId` can contain multiple batches of snapshot submissions from the sequencer, as referenced by the `batchCid`.

The entire contents of this batch are made available on IPFS on the CID `batchCid`.

The elements of the arrays `projectIds` and `snapshotCids` are present as a 1:1 mapping that the sequencer reports as finalized CID against each of the project IDs.

**NOTE**:
* The `projectIds` and `snapshotCids` arrays are expected to be of the same length.
* In the next upgrade, the `projectIds` and `snapshotCids` arrays will be removed. The `finalizedCidsRootHash`, that is the root hash of the merkle tree built from the CIDs of the projects, holds appropriate information to be used in the consensus rule for attestation as well as verification of the batch CID uploaded to IPFS and anchored to the protocol state by this function call.

### Indicating end of batch submissions for an epoch

```solidity
function endBatchSubmissions(uint256 epochId) external onlySequencer
```

### Attestation against submission batches by [validator](https://docs.powerloom.io/docs/Protocol/Protocol_v2/validator)

```solidity
function submitBatchAttestation(
        string memory batchCid,
        uint256 epochId,
        bytes32 finalizedCidsRootHash
    ) public onlyValidator
```

Validators submit their attestations against batches of snapshot submissions in an `epochId` by refererring to their `batchCid`.

The attestation is the `finalizedCidsRootHash` which is the hash of the merkle tree root constructed from the finalized CIDs across the projects contained in a batch.

### Finalization against attestation consensus

`shouldFinalizeBatchAttestation()` is used as the state check whether the consensus rule around attestations submitted by the network of validators is satisfied, followed by a call to `finalizeSnapshotBatch()` that finalizes the snapshot CIDs against the project IDs contained in a `batchCid` for an `epochId`.

```solidity
function shouldFinalizeBatchAttestation(
    string memory batchCid,
    uint256 currentAttestationCount
) private view returns (bool)
```

```solidity
function finalizeSnapshotBatch(string memory batchCid, uint256 epochId) private
```

### Triggering attestation consensus externally

```solidity
function forceCompleteConsensusAttestations(
  PowerloomDataMarket dataMarket, 
  string memory batchCid, 
  uint256 epochId
) public
```

---

## State view: Data market contracts

### Epoch size

```solidity
uint8 public EPOCH_SIZE; // Number of Blocks in each Epoch
```

Refer: [Epoch](https://docs.powerloom.io/docs/Protocol/Specifications/Epoch)
### Data source chain properties

These properties are specific to the chain on which the actual data sources i.e. smart contracts and applications are running.

```solidity
uint256 public SOURCE_CHAIN_ID;
uint256 public SOURCE_CHAIN_BLOCK_TIME; // Block time in seconds * 1e4 (to allow decimals)
```

### Consensus properties

```solidity
uint256 public batchSubmissionWindow // Number of blocks to wait before finalizing batch
uint256 public attestationSubmissionWindow // Number of blocks to wait for attestation acceptance
uint256 public minAttestationsForConsensus // Minimum number of attestations for consensus
```

### Status and CIDs of snapshots

* The snapshot CID reported to have reached consensus against a `projectId` for an `epochId`. The `ConsensusStatus` wraps the [`SnapshotStatus` enum](#snapshot-state).

```solidity
mapping(string projectId => mapping(
  uint256 epochId => ConsensusStatus
)) public snapshotStatus;

function maxSnapshotsCid(
    string memory projectId,
    uint256 epochId
) public view returns (string memory)
```

* Snapshot CID finalized for a project ID against an epoch ID, as reported by the sequencer.

```solidity
mapping(string projectId => uint256 epochId) public lastSequencerFinalizedSnapshot;
```

* Snapshot CID finalized against an epoch ID for each project ID, once validators attest to the finalization from sequencer as shown above.

```solidity
mapping(string projectId => uint256 epochId) public lastFinalizedSnapshot;
```

* The very first epoch ID against which a finalization was achieved for a project ID.

```solidity
mapping(string projectId => uint256 epochId) public projectFirstEpochId;
```

### `batchCidToProjects`

```solidity
mapping(string batchCid => string[] projectids) public batchCidToProjects;
```

Project IDs contained within a Batch CID.

### `epochIdToBatchCids`

```solidity
mapping(uint256 epochId => string[] batchCids) public epochIdToBatchCids;
```

Batch CIDs of submissions sent out for an epoch by the sequencer.

### Validator attestations

```solidity
mapping(string batchCid => mapping(address => bool)) public attestationsReceived;
mapping(string batchCid => mapping(bytes32 finalizedCidsRootHash=> uint256 count)) public attestationsReceivedCount;
mapping(string batchCid => uint256 count) public maxAttestationsCount;
mapping(string batchCid => bytes32 finalizedCidsRootHash) public maxAttestationFinalizedRootHash;
mapping(string batchCid => bool) public batchCidAttestationStatus;
```

Storing attestations received from validator identities and their counts of attestations against finalized root hashes of merkle trees built from CIDs.

```solidity
mapping(string batchCid => bytes32 finalizedCidsRootHash) public batchCidSequencerAttestation;
mapping(string batchCid => address[] validators) public batchCidDivergentValidators;
```

State of the initial attestation as reported by the sequencer as finalized CIDs against the project IDs and the state of them if they diverge from the consensus on attestations as reached by validators.


## State view: Snapshotter identity state contract

### `allSnapshotters(address)`
Mapping to check for existence of snapshotter identity on protocol state.

### `slotSnapshotterMapping(uint256)`

Mapping from slot ID to registered snapshotter node's signing wallet address.

### `slotCounter()`

Number of registered slots on the protocol state.

---

## Events

### Namespaced event emissions

Event emissions specific to data market operations are emitted from the data market contracts as well as the protocol state core contract, which has an additional topic that identifies the data market against which the operation is being performed.

This allows for state and event observers on the protocol to filter events by the data market contract of interest.

For example, the `SnapshotBatchSubmitted` event has the following signatures when emitted from:

#### protocol state core contract

```solidity
event SnapshotBatchSubmitted(
  address indexed dataMarketAddress, 
  string batchCid, 
  uint256 indexed epochId, 
  uint256 timestamp
);
```

#### data market contract

```solidity
event SnapshotBatchSubmitted(
  string batchCid, 
  uint256 indexed epochId, 
  uint256 timestamp
);
```

### Epoch related events

* **`DailyTaskCompletedEvent`:** Emitted when a snapshotter reaches their daily quota of snapshot submission count.

```solidity
event DailyTaskCompletedEvent(
  address indexed dataMarketAddress, 
  address snapshotterAddress, 
  uint256 slotId, 
  uint256 dayId, 
  uint256 timestamp
);
```
Read more: [Daily snapshot quota](#daily-snapshot-quota)

* **`DayStartedEvent`:** Emitted when a new day starts.

```solidity
event DayStartedEvent(
  address indexed dataMarketAddress, 
  uint256 dayId, 
  uint256 timestamp
);
```

Read more: [Day size for a data market](#update-day-size)

* **`EpochReleased`**: Emitted when an epoch is released.

```solidity
event EpochReleased(
  address indexed dataMarketAddress, 
  uint256 indexed epochId, 
  uint256 begin, 
  uint256 end, 
  uint256 timestamp
);
```

Read more: [Epoch release](#epoch-release)

### Snapshot submissions

* **SnapshotBatchSubmitted:** Emitted upon the sequencer submitting a batch of snapshot submissions along with their claimed finalizations for an `epochId`

```solidity
event SnapshotBatchSubmitted(
  address indexed dataMarketAddress,
  string batchCid, 
  uint256 indexed epochId, 
  uint256 timestamp
);
```

* **DelayedBatchSubmitted:** Emitted when the sequencer submits a batch past the submission deadline for an epoch

```solidity
event DelayedBatchSubmitted(
  address indexed dataMarketAddress,
  string batchCid, 
  uint256 indexed epochId, 
  uint256 timestamp
);
```

* **SnapshotBatchFinalized:** Emitted when a majority of the validators have submitted their attestations on a `batchCid` submitted by the sequencer.

```solidity
event SnapshotBatchFinalized(
  uint256 indexed epochId,
  string batchCid,
  uint256 timestamp
);
```

### Validation

* **SnapshotBatchAttestationSubmitted:** Emitted when a validator `validatorAddr` submits their attestation for a `batchCid` batch.

```solidity
event SnapshotBatchAttestationSubmitted(
  string batchCid,
  uint256 indexed epochId,
  uint256 timestamp,
  address indexed validatorAddr
);
```

* **DelayedAttestationSubmitted:** Emitted when a validator `validatorAddr` submits their attestation for a `batchCid` batch past the submission deadline

```solidity
event DelayedAttestationSubmitted(
  string batchCid,
  uint256 indexed epochId,
  uint256 timestamp,
  address indexed validatorAddr
);
```

### More details:  
Each of the components has a detailed documentation in the `docs` folder:
* [SnapshotterState](./hardhat/docs/README_SnapshotterState.md)
* [DataMarket](./hardhat/docs/README_DataMarket.md)
* [DataMarketFactory](./hardhat/docs/README_DataMarketFactory.md)
* [Error Codes](./hardhat/docs/error-codes.md)

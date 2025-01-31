const { expect, should } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("PowerloomProtocolState Upgrade", function () {
    let PowerloomProtocolState, PowerloomProtocolStateV2, protocolStateProxy, upgradedProtocol, deployer, other;

    before(async function () {
        [deployer, other] = await ethers.getSigners();
        // Deploy the storage contract
        const SnapshotterState = await ethers.getContractFactory("PowerloomNodes");
        snapshotterState = await upgrades.deployProxy(SnapshotterState, [deployer.address, 10000, "Test"]);
        await snapshotterState.waitForDeployment();

        // Deploy the DataMarketFactory contract
        const DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
        dataMarketFactory = await DataMarketFactory.deploy();
        await dataMarketFactory.waitForDeployment();

        // Deploy the initial version of the contract
        PowerloomProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
        protocolStateProxy = await upgrades.deployProxy(PowerloomProtocolState, [deployer.address, await snapshotterState.getAddress(), await dataMarketFactory.getAddress()]);
        await protocolStateProxy.waitForDeployment();
    });

    it("should upgrade to PowerloomProtocolStateV2 and keep the same address", async function () {
        // Upgrade to ProtocolLogicV2
        PowerloomProtocolStateV2 = await ethers.getContractFactory("PowerloomProtocolStateV2");
        upgradedProtocol = await upgrades.upgradeProxy(await protocolStateProxy.getAddress(), PowerloomProtocolStateV2);
        await upgradedProtocol.waitForDeployment();

        expect(await protocolStateProxy.getAddress()).to.equal(await upgradedProtocol.getAddress());
    });

    it("should return the correct string from newFunctionality after upgrade", async function () {
        const callResponse = await upgradedProtocol.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });

    it("should correctly set and get values in newMapping after upgrade", async function () {
        await upgradedProtocol.setNewMapping(other.address, 100);
        const checkMapping = await upgradedProtocol.newMapping(other.address);
        expect(checkMapping).to.equal(100);
    });

    it("should break if you try to deploy incompatible memory layout in an upgrade", async function () {
        PowerloomProtocolStateV3Broken = await ethers.getContractFactory("PowerloomProtocolStateV3Broken");
        expect(upgrades.upgradeProxy(await protocolStateProxy.getAddress(), PowerloomProtocolStateV3Broken)).to.be.rejectedWith();
    });

    // TODO: Add more tests for the upgradeability
});

describe("Data Market Upgrade", function () {
    let PowerloomProtocolState, PowerloomDataMarket, protocolStateProxy, dataMarketFactory, dataMarket, owner, other1, other2, other3;

    let upgradedDataMarket;
    
    beforeEach(async function () {
        [owner, other1, other2, other3] = await ethers.getSigners();

        // Deploy the storage contract
        const SnapshotterState = await ethers.getContractFactory("PowerloomNodes");
        snapshotterState = await upgrades.deployProxy(SnapshotterState, [owner.address, 10000, "Test"]);
        await snapshotterState.waitForDeployment();

        // Deploy the DataMarketFactory contract
        const DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
        dataMarketFactory = await DataMarketFactory.deploy();
        await dataMarketFactory.waitForDeployment();
        
        // Deploy the protocol state contract
        PowerloomProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
        protocolStateProxy = await upgrades.deployProxy(PowerloomProtocolState, [owner.address, await snapshotterState.getAddress(), await dataMarketFactory.getAddress()]);
        await protocolStateProxy.waitForDeployment();

        // Deploy the PowerloomNodes contract
        PowerloomNodes = await ethers.getContractFactory("PowerloomNodes");
        nodesProxy = await upgrades.deployProxy(PowerloomNodes, [owner.address, 1, "PowerloomTest"]);
        await nodesProxy.waitForDeployment();

        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nodesProxy.setMintStartTime(blockTimestamp - 100);
        await nodesProxy.connect(owner).mintNode(1, { value: 1 });
        await nodesProxy.connect(owner).assignSnapshotterToNode(1, owner.address);
        await protocolStateProxy.updateSnapshotterState(await nodesProxy.getAddress());

        // Create a data market
        const dataMarketTx = await protocolStateProxy.createDataMarket(
            owner.address,    // owner
            10,              // epochSize
            137,            // sourceChainId
            20000,          // sourceChainBlockTime
            false           // useBlockNumberAsEpochId
        );
        await dataMarketTx.wait();

        // Get the data market address from events
        const filter = dataMarketFactory.filters.DataMarketCreated();
        const logs = await dataMarketFactory.queryFilter(filter, 0, "latest");
        const dataMarketAddress = logs[0].args.dataMarketAddress;

        // Attach to the deployed data market
        PowerloomDataMarket = await ethers.getContractFactory("PowerloomDataMarket");
        dataMarket = PowerloomDataMarket.attach(dataMarketAddress);

        // Force import the proxy contract to register it with the upgrades plugin
        await upgrades.forceImport(dataMarketAddress, PowerloomDataMarket);
    });

    it("should upgrade to TestPowerloomDataMarket and keep the same address", async function () {
        
        // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/495a287e9ab38afe8ed165b767a8a901fc47c5fb/contracts/proxy/ERC1967/ERC1967Proxy.sol#L30-L36
        const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
        const currentImplementation = await ethers.provider.getStorage(await dataMarket.getAddress(), IMPLEMENTATION_SLOT);

        DataMarketTestUpgrade = await ethers.getContractFactory("DataMarketTestUpgrade");
        upgradedDataMarket = await upgrades.upgradeProxy(await dataMarket.getAddress(), DataMarketTestUpgrade);
        await upgradedDataMarket.waitForDeployment();

        const newImplementation = await ethers.provider.getStorage(await dataMarket.getAddress(), IMPLEMENTATION_SLOT);

        expect(await dataMarket.getAddress()).to.equal(await upgradedDataMarket.getAddress());
        expect(currentImplementation).to.not.equal(newImplementation);
    });

    it("should return the correct string from newFunctionality after upgrade", async function () {
        DataMarketTestUpgrade = await ethers.getContractFactory("DataMarketTestUpgrade");
        upgradedDataMarket = await upgrades.upgradeProxy(await dataMarket.getAddress(), DataMarketTestUpgrade);
        await upgradedDataMarket.waitForDeployment();
        const callResponse = await upgradedDataMarket.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });

    it("should verify that the data market contract state is the same", async function () {
        // Setup initial state with multiple test cases
        await protocolStateProxy.updateAddresses(
            dataMarket.target,
            1,
            [other1.address], 
            [true],
        );

        await protocolStateProxy.updateAddresses(
            dataMarket.target,
            0,
            [other1.address, other2.address, other3.address], 
            [true, true, true],
        );

        await protocolStateProxy.updateAddresses(
            dataMarket.target,
            2,
            [other1.address, other2.address, other3.address], 
            [true, true, true],
        );

        await protocolStateProxy.setSequencerId(
            dataMarket.target,
            other1.address,
        );

        await protocolStateProxy.updateEpochManager(
            dataMarket.target,
            other1.address,
        );

        // Release an epoch and submit test data
        await protocolStateProxy.connect(other1).releaseEpoch(
            dataMarket.target,
            1,
            10
        );

        // Test data for mappings
        const testBatchCid = "QmTest123";
        const testProjectIds = ["project1", "project2", "project3"];
        const testFinalizedRootHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

        // Setup test data
        const testValidators = [other1.address, other2.address, other3.address];

        // Capture pre-upgrade state
        const preUpgradeState = {
            // Public state variables
            sequencerId: await dataMarket.sequencerId(),
            protocolState: await dataMarket.protocolState(),
            currentEpoch: await dataMarket.currentEpoch(),
            rewardPoolSize: await dataMarket.rewardPoolSize(),
            dailySnapshotQuota: await dataMarket.dailySnapshotQuota(),
            dayCounter: await dataMarket.dayCounter(),
            epochsInADay: await dataMarket.epochsInADay(),
            epochIdCounter: await dataMarket.epochIdCounter(),
            epochManager: await dataMarket.epochManager(),
            isInitialized: await dataMarket.isInitialized(),
            EPOCH_SIZE: await dataMarket.EPOCH_SIZE(),
            SOURCE_CHAIN_ID: await dataMarket.SOURCE_CHAIN_ID(),
            SOURCE_CHAIN_BLOCK_TIME: await dataMarket.SOURCE_CHAIN_BLOCK_TIME(),
            deploymentBlockNumber: await dataMarket.deploymentBlockNumber(),
            USE_BLOCK_NUMBER_AS_EPOCH_ID: await dataMarket.USE_BLOCK_NUMBER_AS_EPOCH_ID(),
            DAY_SIZE: await dataMarket.DAY_SIZE(),
            rewardsEnabled: await dataMarket.rewardsEnabled(),
            snapshotSubmissionWindow: await dataMarket.snapshotSubmissionWindow(),
            batchSubmissionWindow: await dataMarket.batchSubmissionWindow(),
            attestationSubmissionWindow: await dataMarket.attestationSubmissionWindow(),
            minAttestationsForConsensus: await dataMarket.minAttestationsForConsensus(),

            // EnumerableSet state
            validators: await dataMarket.getValidators(),
            sequencers: await dataMarket.getSequencers(),
            admins: await dataMarket.getAdmins(),

            // Mappings
            epochInfo: {
                1: await dataMarket.epochInfo(1),
                2: await dataMarket.epochInfo(2)
            },
            batchCidToProjects: await dataMarket.getBatchCidToProjects(testBatchCid),
            epochIdToBatchCids: await dataMarket.getEpochIdToBatchCids(1),
            attestationsReceived: {
                [testBatchCid]: {
                    [other1.address]: await dataMarket.attestationsReceived(testBatchCid, other1.address),
                    [other2.address]: await dataMarket.attestationsReceived(testBatchCid, other2.address)
                }
            },
            attestationsReceivedCount: await dataMarket.attestationsReceivedCount(testBatchCid, testFinalizedRootHash),
            maxAttestationsCount: await dataMarket.maxAttestationsCount(testBatchCid),
            maxAttestationFinalizedRootHash: await dataMarket.maxAttestationFinalizedRootHash(testBatchCid),
            batchCidSequencerAttestation: await dataMarket.batchCidSequencerAttestation(testBatchCid),
            batchCidAttestationStatus: await dataMarket.batchCidAttestationStatus(testBatchCid),
            epochIdToBatchSubmissionsCompleted: await dataMarket.epochIdToBatchSubmissionsCompleted(1),
            snapshotStatus: {
                [testProjectIds[0]]: {
                    1: await dataMarket.snapshotStatus(testProjectIds[0], 1)
                }
            },
            lastFinalizedSnapshot: await dataMarket.lastFinalizedSnapshot(testProjectIds[0]),
            lastSequencerFinalizedSnapshot: await dataMarket.lastSequencerFinalizedSnapshot(testProjectIds[0]),
            projectFirstEpochId: await dataMarket.projectFirstEpochId(testProjectIds[0]),
            slotSubmissionCount: {
                1: {
                    1: await dataMarket.slotSubmissionCount(1, 1)
                }
            },
            slotRewardPoints: await dataMarket.slotRewardPoints(1),
            eligibleNodesForDay: await dataMarket.eligibleNodesForDay(1),
            slotRewardsDistributedStatus: {
                1: {
                    1: await dataMarket.slotRewardsDistributedStatus(1, 1)
                }
            },
            slotsRemainingToBeRewardedCount: await dataMarket.slotsRemainingToBeRewardedCount(1),
            validatorAttestationsReceived: {
                [other1.address]: {
                    1: {
                        [testBatchCid]: await dataMarket.validatorAttestationsReceived(other1.address, 1, testBatchCid)
                    }
                }
            }
        };

        // Perform upgrade
        DataMarketTestUpgrade = await ethers.getContractFactory("DataMarketTestUpgrade");
        upgradedDataMarket = await upgrades.upgradeProxy(await dataMarket.getAddress(), DataMarketTestUpgrade);
        await upgradedDataMarket.waitForDeployment();

        // Capture post-upgrade state
        const postUpgradeState = {
            // Public state variables
            sequencerId: await upgradedDataMarket.sequencerId(),
            protocolState: await upgradedDataMarket.protocolState(),
            currentEpoch: await upgradedDataMarket.currentEpoch(),
            rewardPoolSize: await upgradedDataMarket.rewardPoolSize(),
            dailySnapshotQuota: await upgradedDataMarket.dailySnapshotQuota(),
            dayCounter: await upgradedDataMarket.dayCounter(),
            epochsInADay: await upgradedDataMarket.epochsInADay(),
            epochIdCounter: await upgradedDataMarket.epochIdCounter(),
            epochManager: await upgradedDataMarket.epochManager(),
            isInitialized: await upgradedDataMarket.isInitialized(),
            EPOCH_SIZE: await upgradedDataMarket.EPOCH_SIZE(),
            SOURCE_CHAIN_ID: await upgradedDataMarket.SOURCE_CHAIN_ID(),
            SOURCE_CHAIN_BLOCK_TIME: await upgradedDataMarket.SOURCE_CHAIN_BLOCK_TIME(),
            deploymentBlockNumber: await upgradedDataMarket.deploymentBlockNumber(),
            USE_BLOCK_NUMBER_AS_EPOCH_ID: await upgradedDataMarket.USE_BLOCK_NUMBER_AS_EPOCH_ID(),
            DAY_SIZE: await upgradedDataMarket.DAY_SIZE(),
            rewardsEnabled: await upgradedDataMarket.rewardsEnabled(),
            snapshotSubmissionWindow: await upgradedDataMarket.snapshotSubmissionWindow(),
            batchSubmissionWindow: await upgradedDataMarket.batchSubmissionWindow(),
            attestationSubmissionWindow: await upgradedDataMarket.attestationSubmissionWindow(),
            minAttestationsForConsensus: await upgradedDataMarket.minAttestationsForConsensus(),

            // EnumerableSet state
            validators: await upgradedDataMarket.getValidators(),
            sequencers: await upgradedDataMarket.getSequencers(),
            admins: await upgradedDataMarket.getAdmins(),

            // Mappings
            epochInfo: {
                1: await upgradedDataMarket.epochInfo(1),
                2: await upgradedDataMarket.epochInfo(2)
            },
            batchCidToProjects: await upgradedDataMarket.getBatchCidToProjects(testBatchCid),
            epochIdToBatchCids: await upgradedDataMarket.getEpochIdToBatchCids(1),
            attestationsReceived: {
                [testBatchCid]: {
                    [other1.address]: await upgradedDataMarket.attestationsReceived(testBatchCid, other1.address),
                    [other2.address]: await upgradedDataMarket.attestationsReceived(testBatchCid, other2.address)
                }
            },
            attestationsReceivedCount: await upgradedDataMarket.attestationsReceivedCount(testBatchCid, testFinalizedRootHash),
            maxAttestationsCount: await upgradedDataMarket.maxAttestationsCount(testBatchCid),
            maxAttestationFinalizedRootHash: await upgradedDataMarket.maxAttestationFinalizedRootHash(testBatchCid),
            batchCidSequencerAttestation: await upgradedDataMarket.batchCidSequencerAttestation(testBatchCid),
            batchCidAttestationStatus: await upgradedDataMarket.batchCidAttestationStatus(testBatchCid),
            epochIdToBatchSubmissionsCompleted: await upgradedDataMarket.epochIdToBatchSubmissionsCompleted(1),
            snapshotStatus: {
                [testProjectIds[0]]: {
                    1: await upgradedDataMarket.snapshotStatus(testProjectIds[0], 1)
                }
            },
            lastFinalizedSnapshot: await upgradedDataMarket.lastFinalizedSnapshot(testProjectIds[0]),
            lastSequencerFinalizedSnapshot: await upgradedDataMarket.lastSequencerFinalizedSnapshot(testProjectIds[0]),
            projectFirstEpochId: await upgradedDataMarket.projectFirstEpochId(testProjectIds[0]),
            slotSubmissionCount: {
                1: {
                    1: await upgradedDataMarket.slotSubmissionCount(1, 1)
                }
            },
            slotRewardPoints: await upgradedDataMarket.slotRewardPoints(1),
            eligibleNodesForDay: await upgradedDataMarket.eligibleNodesForDay(1),
            slotRewardsDistributedStatus: {
                1: {
                    1: await upgradedDataMarket.slotRewardsDistributedStatus(1, 1)
                }
            },
            slotsRemainingToBeRewardedCount: await upgradedDataMarket.slotsRemainingToBeRewardedCount(1),
            validatorAttestationsReceived: {
                [other1.address]: {
                    1: {
                        [testBatchCid]: await upgradedDataMarket.validatorAttestationsReceived(other1.address, 1, testBatchCid)
                    }
                }
            }
        };

        // Verify all state variables are preserved
        expect(postUpgradeState.sequencerId).to.equal(preUpgradeState.sequencerId);
        expect(postUpgradeState.protocolState).to.equal(preUpgradeState.protocolState);
        
        // Compare Epoch struct fields individually
        expect(postUpgradeState.currentEpoch.begin).to.equal(preUpgradeState.currentEpoch.begin);
        expect(postUpgradeState.currentEpoch.end).to.equal(preUpgradeState.currentEpoch.end);
        expect(postUpgradeState.currentEpoch.epochId).to.equal(preUpgradeState.currentEpoch.epochId);

        expect(postUpgradeState.rewardPoolSize).to.equal(preUpgradeState.rewardPoolSize);
        expect(postUpgradeState.dailySnapshotQuota).to.equal(preUpgradeState.dailySnapshotQuota);
        expect(postUpgradeState.dayCounter).to.equal(preUpgradeState.dayCounter);
        expect(postUpgradeState.epochsInADay).to.equal(preUpgradeState.epochsInADay);
        expect(postUpgradeState.epochIdCounter).to.equal(preUpgradeState.epochIdCounter);
        expect(postUpgradeState.epochManager).to.equal(preUpgradeState.epochManager);
        expect(postUpgradeState.isInitialized).to.equal(preUpgradeState.isInitialized);
        expect(postUpgradeState.EPOCH_SIZE).to.equal(preUpgradeState.EPOCH_SIZE);
        expect(postUpgradeState.SOURCE_CHAIN_ID).to.equal(preUpgradeState.SOURCE_CHAIN_ID);
        expect(postUpgradeState.SOURCE_CHAIN_BLOCK_TIME).to.equal(preUpgradeState.SOURCE_CHAIN_BLOCK_TIME);
        expect(postUpgradeState.deploymentBlockNumber).to.equal(preUpgradeState.deploymentBlockNumber);
        expect(postUpgradeState.USE_BLOCK_NUMBER_AS_EPOCH_ID).to.equal(preUpgradeState.USE_BLOCK_NUMBER_AS_EPOCH_ID);
        expect(postUpgradeState.DAY_SIZE).to.equal(preUpgradeState.DAY_SIZE);
        expect(postUpgradeState.rewardsEnabled).to.equal(preUpgradeState.rewardsEnabled);
        expect(postUpgradeState.snapshotSubmissionWindow).to.equal(preUpgradeState.snapshotSubmissionWindow);
        expect(postUpgradeState.batchSubmissionWindow).to.equal(preUpgradeState.batchSubmissionWindow);
        expect(postUpgradeState.attestationSubmissionWindow).to.equal(preUpgradeState.attestationSubmissionWindow);
        expect(postUpgradeState.minAttestationsForConsensus).to.equal(preUpgradeState.minAttestationsForConsensus);

        // Verify mappings for all indices
        for (let i = 1; i <= 2; i++) {
            expect(postUpgradeState.epochInfo[i]).to.deep.equal(preUpgradeState.epochInfo[i]);
            expect(postUpgradeState.batchCidToProjects[testBatchCid]).to.deep.equal(preUpgradeState.batchCidToProjects[testBatchCid]);
            expect(postUpgradeState.attestationsReceived[testBatchCid][other1.address]).to.equal(preUpgradeState.attestationsReceived[testBatchCid][other1.address]);
            expect(postUpgradeState.attestationsReceived[testBatchCid][other2.address]).to.equal(preUpgradeState.attestationsReceived[testBatchCid][other2.address]);
            expect(postUpgradeState.attestationsReceivedCount).to.equal(preUpgradeState.attestationsReceivedCount);
            expect(postUpgradeState.maxAttestationsCount).to.equal(preUpgradeState.maxAttestationsCount);
            expect(postUpgradeState.maxAttestationFinalizedRootHash).to.equal(preUpgradeState.maxAttestationFinalizedRootHash);
            expect(postUpgradeState.batchCidSequencerAttestation).to.equal(preUpgradeState.batchCidSequencerAttestation);
            expect(postUpgradeState.batchCidAttestationStatus).to.equal(preUpgradeState.batchCidAttestationStatus);
            expect(postUpgradeState.epochIdToBatchSubmissionsCompleted).to.equal(preUpgradeState.epochIdToBatchSubmissionsCompleted);
            expect(postUpgradeState.snapshotStatus[testProjectIds[0]][1].status).to.equal(preUpgradeState.snapshotStatus[testProjectIds[0]][1].status);
            expect(postUpgradeState.snapshotStatus[testProjectIds[0]][1].snapshotCid).to.equal(preUpgradeState.snapshotStatus[testProjectIds[0]][1].snapshotCid);
            expect(postUpgradeState.lastFinalizedSnapshot).to.equal(preUpgradeState.lastFinalizedSnapshot);
            expect(postUpgradeState.lastSequencerFinalizedSnapshot).to.equal(preUpgradeState.lastSequencerFinalizedSnapshot);
            expect(postUpgradeState.projectFirstEpochId).to.equal(preUpgradeState.projectFirstEpochId);
            expect(postUpgradeState.slotSubmissionCount[1][1]).to.equal(preUpgradeState.slotSubmissionCount[1][1]);
            expect(postUpgradeState.slotRewardPoints).to.equal(preUpgradeState.slotRewardPoints);
            expect(postUpgradeState.eligibleNodesForDay).to.equal(preUpgradeState.eligibleNodesForDay);
            expect(postUpgradeState.slotRewardsDistributedStatus[1][1]).to.equal(preUpgradeState.slotRewardsDistributedStatus[1][1]);
            expect(postUpgradeState.slotsRemainingToBeRewardedCount).to.equal(preUpgradeState.slotsRemainingToBeRewardedCount);
            expect(postUpgradeState.validatorAttestationsReceived[other1.address][1][testBatchCid]).to.equal(preUpgradeState.validatorAttestationsReceived[other1.address][1][testBatchCid]);
        }

        // Simple comparison for single epoch
        expect(postUpgradeState.epochIdToBatchCids)
            .to.deep.equal(preUpgradeState.epochIdToBatchCids,
                "epochIdToBatchCids mismatch");

        // Verify new functionality works
        const callResponse = await upgradedDataMarket.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });
});

describe("Snapshotter State Upgrade", function () {
    let PowerloomNodes, nodesProxy, upgradedNodes, owner, other1, other2, other3;

    beforeEach(async function () {
        [owner, other1, other2, other3] = await ethers.getSigners();

        // Deploy the initial version of PowerloomNodes
        PowerloomNodes = await ethers.getContractFactory("PowerloomNodes");
        nodesProxy = await upgrades.deployProxy(PowerloomNodes, [owner.address, 10000, "Test"]);
        await nodesProxy.waitForDeployment();
    });

    it("should upgrade to PowerloomNodesUpgrade and keep the same address", async function () {
        // Get implementation slot value before upgrade
        const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
        const currentImplementation = await ethers.provider.getStorage(await nodesProxy.getAddress(), IMPLEMENTATION_SLOT);

        // Perform upgrade
        const NodesUpgrade = await ethers.getContractFactory("PowerloomNodesUpgrade");
        upgradedNodes = await upgrades.upgradeProxy(await nodesProxy.getAddress(), NodesUpgrade);
        await upgradedNodes.waitForDeployment();

        // Get implementation slot value after upgrade
        const newImplementation = await ethers.provider.getStorage(await nodesProxy.getAddress(), IMPLEMENTATION_SLOT);

        // Verify proxy address remains the same but implementation changes
        expect(await nodesProxy.getAddress()).to.equal(await upgradedNodes.getAddress());
        expect(currentImplementation).to.not.equal(newImplementation);
    });

    it("should return the correct string from newFunctionality after upgrade", async function () {
        // Perform upgrade
        const NodesUpgrade = await ethers.getContractFactory("PowerloomNodesUpgrade");
        upgradedNodes = await upgrades.upgradeProxy(await nodesProxy.getAddress(), NodesUpgrade);
        await upgradedNodes.waitForDeployment();

        // Test new functionality
        const callResponse = await upgradedNodes.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });

    it("should verify that the contract state is preserved after upgrade", async function () {
        // Setup initial state
        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nodesProxy.setMintStartTime(blockTimestamp - 100);
        
        // Mint multiple nodes and assign snapshotters
        await nodesProxy.connect(owner).mintNode(3, { value: 30000 }); // Mint 3 nodes
        await nodesProxy.connect(owner).assignSnapshotterToNode(1, other1.address);
        await nodesProxy.connect(owner).assignSnapshotterToNode(2, other2.address);
        await nodesProxy.connect(owner).assignSnapshotterToNode(3, other3.address);

        // Set up additional state
        await nodesProxy.configureLegacyNodes(
            100, // legacyNodeCount
            100000, // legacyNodeInitialClaimPercentage (10%)
            30, // legacyNodeCliff
            20000, // legacyNodeValue
            365, // legacyNodeVestingDays
            blockTimestamp, // legacyNodeVestingStart
            5000, // legacyTokensSentOnL1
            60 // legacyNodeNonKycedCooldown
        );
        await nodesProxy.setSnapshotterAddressChangeCooldown(3600);
        await nodesProxy.setSnapshotterTokenClaimCooldown(7200);
        await nodesProxy.updateMaxSupply(20000);
        await nodesProxy.updateNodePrice(15000);
        await nodesProxy.updateAdmins([other2.address, other3.address], [true, true]);

        // Capture pre-upgrade state
        const preUpgradeState = {
            // Basic state variables
            nodePrice: await nodesProxy.nodePrice(),
            nodeCount: await nodesProxy.nodeCount(),
            enabledNodeCount: await nodesProxy.enabledNodeCount(),
            name: await nodesProxy.name(),
            MAX_SUPPLY: await nodesProxy.MAX_SUPPLY(),

            // Legacy node configuration
            legacyNodeCount: await nodesProxy.legacyNodeCount(),
            legacyNodeInitialClaimPercentage: await nodesProxy.legacyNodeInitialClaimPercentage(),
            legacyNodeCliff: await nodesProxy.legacyNodeCliff(),
            legacyNodeValue: await nodesProxy.legacyNodeValue(),
            legacyTokensSentOnL1: await nodesProxy.legacyTokensSentOnL1(),
            legacyNodeVestingDays: await nodesProxy.legacyNodeVestingDays(),
            legacyNodeVestingStart: await nodesProxy.legacyNodeVestingStart(),
            legacyNodeNonKycedCooldown: await nodesProxy.legacyNodeNonKycedCooldown(),

            // Timing configurations
            mintStartTime: await nodesProxy.mintStartTime(),
            snapshotterAddressChangeCooldown: await nodesProxy.snapshotterAddressChangeCooldown(),
            snapshotterTokenClaimCooldown: await nodesProxy.snapshotterTokenClaimCooldown(),

            // Node specific data
            nodeInfo: {
                1: await nodesProxy.nodeInfo(1),
                2: await nodesProxy.nodeInfo(2),
                3: await nodesProxy.nodeInfo(3)
            },
            nodeIdToOwner: {
                1: await nodesProxy.nodeIdToOwner(1),
                2: await nodesProxy.nodeIdToOwner(2),
                3: await nodesProxy.nodeIdToOwner(3)
            },
            isNodeBurned: {
                1: await nodesProxy.isNodeBurned(1),
                2: await nodesProxy.isNodeBurned(2),
                3: await nodesProxy.isNodeBurned(3)
            },
            lastSnapshotterChange: {
                1: await nodesProxy.lastSnapshotterChange(1),
                2: await nodesProxy.lastSnapshotterChange(2),
                3: await nodesProxy.lastSnapshotterChange(3)
            },

            // Snapshotter tracking
            allSnapshotters: await nodesProxy.allSnapshotters(other1.address),

            // Admin related
            admins: await nodesProxy.getAdmins(),
            owner: await nodesProxy.owner(),

            // EnumerableSet derived data
            userTokenIds: await nodesProxy.getUserOwnedNodeIds(owner.address),
            burnedUserTokenIds: await nodesProxy.getUserBurnedNodeIds(owner.address),
            totalSnapshotterCount: await nodesProxy.getTotalSnapshotterCount(),

            // ERC1155 related
            totalSupply: await nodesProxy.totalSupply(),
            balance: await nodesProxy.balanceOf(owner.address, 1),
            paused: await nodesProxy.paused(),

            // Additional mapping checks for multiple indices
            snapshotterToNodeIds: {
                1: await nodesProxy.nodeSnapshotterMapping(1),
                2: await nodesProxy.nodeSnapshotterMapping(2),
                3: await nodesProxy.nodeSnapshotterMapping(3)
            },
            nodeIdToVestingInfo: {
                1: await nodesProxy.nodeIdToVestingInfo(1),
                2: await nodesProxy.nodeIdToVestingInfo(2),
                3: await nodesProxy.nodeIdToVestingInfo(3)
            },
        };

        // Perform upgrade
        const NodesUpgrade = await ethers.getContractFactory("PowerloomNodesUpgrade");
        upgradedNodes = await upgrades.upgradeProxy(await nodesProxy.getAddress(), NodesUpgrade);
        await upgradedNodes.waitForDeployment();

        // Capture post-upgrade state
        const postUpgradeState = {
            // Basic state variables
            nodePrice: await upgradedNodes.nodePrice(),
            nodeCount: await upgradedNodes.nodeCount(),
            enabledNodeCount: await upgradedNodes.enabledNodeCount(),
            name: await upgradedNodes.name(),
            MAX_SUPPLY: await upgradedNodes.MAX_SUPPLY(),

            // Legacy node configuration
            legacyNodeCount: await upgradedNodes.legacyNodeCount(),
            legacyNodeInitialClaimPercentage: await upgradedNodes.legacyNodeInitialClaimPercentage(),
            legacyNodeCliff: await upgradedNodes.legacyNodeCliff(),
            legacyNodeValue: await upgradedNodes.legacyNodeValue(),
            legacyTokensSentOnL1: await upgradedNodes.legacyTokensSentOnL1(),
            legacyNodeVestingDays: await upgradedNodes.legacyNodeVestingDays(),
            legacyNodeVestingStart: await upgradedNodes.legacyNodeVestingStart(),
            legacyNodeNonKycedCooldown: await upgradedNodes.legacyNodeNonKycedCooldown(),

            // Timing configurations
            mintStartTime: await upgradedNodes.mintStartTime(),
            snapshotterAddressChangeCooldown: await upgradedNodes.snapshotterAddressChangeCooldown(),
            snapshotterTokenClaimCooldown: await upgradedNodes.snapshotterTokenClaimCooldown(),

            // Node specific data
            nodeInfo: {
                1: await upgradedNodes.nodeInfo(1),
                2: await upgradedNodes.nodeInfo(2),
                3: await upgradedNodes.nodeInfo(3)
            },
            nodeIdToOwner: {
                1: await upgradedNodes.nodeIdToOwner(1),
                2: await upgradedNodes.nodeIdToOwner(2),
                3: await upgradedNodes.nodeIdToOwner(3)
            },
            isNodeBurned: {
                1: await upgradedNodes.isNodeBurned(1),
                2: await upgradedNodes.isNodeBurned(2),
                3: await upgradedNodes.isNodeBurned(3)
            },
            lastSnapshotterChange: {
                1: await upgradedNodes.lastSnapshotterChange(1),
                2: await upgradedNodes.lastSnapshotterChange(2),
                3: await upgradedNodes.lastSnapshotterChange(3)
            },

            // Snapshotter tracking
            allSnapshotters: await upgradedNodes.allSnapshotters(other1.address),

            // Admin related
            admins: await upgradedNodes.getAdmins(),
            owner: await upgradedNodes.owner(),

            // EnumerableSet derived data
            userTokenIds: await upgradedNodes.getUserOwnedNodeIds(owner.address),
            burnedUserTokenIds: await upgradedNodes.getUserBurnedNodeIds(owner.address),
            totalSnapshotterCount: await upgradedNodes.getTotalSnapshotterCount(),

            // ERC1155 related
            totalSupply: await upgradedNodes.totalSupply(),
            balance: await upgradedNodes.balanceOf(owner.address, 1),
            paused: await upgradedNodes.paused(),

            // Additional mapping checks for multiple indices
            snapshotterToNodeIds: {
                1: await upgradedNodes.nodeSnapshotterMapping(1),
                2: await upgradedNodes.nodeSnapshotterMapping(2),
                3: await upgradedNodes.nodeSnapshotterMapping(3)
            },
            nodeIdToVestingInfo: {
                1: await upgradedNodes.nodeIdToVestingInfo(1),
                2: await upgradedNodes.nodeIdToVestingInfo(2),
                3: await upgradedNodes.nodeIdToVestingInfo(3)
            },
        };

        // Verify all state variables are preserved
        expect(postUpgradeState.nodePrice).to.equal(preUpgradeState.nodePrice);
        expect(postUpgradeState.nodeCount).to.equal(preUpgradeState.nodeCount);
        expect(postUpgradeState.enabledNodeCount).to.equal(preUpgradeState.enabledNodeCount);
        expect(postUpgradeState.name).to.equal(preUpgradeState.name);
        expect(postUpgradeState.MAX_SUPPLY).to.equal(preUpgradeState.MAX_SUPPLY);

        // Legacy node configuration
        expect(postUpgradeState.legacyNodeCount).to.equal(preUpgradeState.legacyNodeCount);
        expect(postUpgradeState.legacyNodeInitialClaimPercentage).to.equal(preUpgradeState.legacyNodeInitialClaimPercentage);
        expect(postUpgradeState.legacyNodeCliff).to.equal(preUpgradeState.legacyNodeCliff);
        expect(postUpgradeState.legacyNodeValue).to.equal(preUpgradeState.legacyNodeValue);
        expect(postUpgradeState.legacyTokensSentOnL1).to.equal(preUpgradeState.legacyTokensSentOnL1);
        expect(postUpgradeState.legacyNodeVestingDays).to.equal(preUpgradeState.legacyNodeVestingDays);
        expect(postUpgradeState.legacyNodeVestingStart).to.equal(preUpgradeState.legacyNodeVestingStart);
        expect(postUpgradeState.legacyNodeNonKycedCooldown).to.equal(preUpgradeState.legacyNodeNonKycedCooldown);

        // Timing configurations
        expect(postUpgradeState.mintStartTime).to.equal(preUpgradeState.mintStartTime);
        expect(postUpgradeState.snapshotterAddressChangeCooldown).to.equal(preUpgradeState.snapshotterAddressChangeCooldown);
        expect(postUpgradeState.snapshotterTokenClaimCooldown).to.equal(preUpgradeState.snapshotterTokenClaimCooldown);

        // Verify mappings for all indices
        for (let i = 1; i <= 3; i++) {
            // Verify snapshotterToNodeIds mapping
            expect(postUpgradeState.snapshotterToNodeIds[i]).to.equal(
                preUpgradeState.snapshotterToNodeIds[i],
                `snapshotterToNodeIds mismatch for index ${i}`
            );

            // Verify nodeIdToVestingInfo mapping
            expect(postUpgradeState.nodeIdToVestingInfo[i].owner).to.equal(
                preUpgradeState.nodeIdToVestingInfo[i].owner,
                `nodeIdToVestingInfo owner mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeIdToVestingInfo[i].initialClaim).to.equal(
                preUpgradeState.nodeIdToVestingInfo[i].initialClaim,
                `nodeIdToVestingInfo initialClaim mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeIdToVestingInfo[i].tokensAfterInitialClaim).to.equal(
                preUpgradeState.nodeIdToVestingInfo[i].tokensAfterInitialClaim,
                `nodeIdToVestingInfo tokensAfterInitialClaim mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeIdToVestingInfo[i].tokensClaimed).to.equal(
                preUpgradeState.nodeIdToVestingInfo[i].tokensClaimed,
                `nodeIdToVestingInfo tokensClaimed mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeIdToVestingInfo[i].lastClaim).to.equal(
                preUpgradeState.nodeIdToVestingInfo[i].lastClaim,
                `nodeIdToVestingInfo lastClaim mismatch for index ${i}`
            );

            // Verify nodeInfo mapping
            expect(postUpgradeState.nodeInfo[i].snapshotterAddress).to.equal(
                preUpgradeState.nodeInfo[i].snapshotterAddress,
                `nodeInfo snapshotterAddress mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].nodePrice).to.equal(
                preUpgradeState.nodeInfo[i].nodePrice,
                `nodeInfo nodePrice mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].amountSentOnL1).to.equal(
                preUpgradeState.nodeInfo[i].amountSentOnL1,
                `nodeInfo amountSentOnL1 mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].mintedOn).to.equal(
                preUpgradeState.nodeInfo[i].mintedOn,
                `nodeInfo mintedOn mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].burnedOn).to.equal(
                preUpgradeState.nodeInfo[i].burnedOn,
                `nodeInfo burnedOn mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].lastUpdated).to.equal(
                preUpgradeState.nodeInfo[i].lastUpdated,
                `nodeInfo lastUpdated mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].isLegacy).to.equal(
                preUpgradeState.nodeInfo[i].isLegacy,
                `nodeInfo isLegacy mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].claimedTokens).to.equal(
                preUpgradeState.nodeInfo[i].claimedTokens,
                `nodeInfo claimedTokens mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].active).to.equal(
                preUpgradeState.nodeInfo[i].active,
                `nodeInfo active mismatch for index ${i}`
            );
            expect(postUpgradeState.nodeInfo[i].isKyced).to.equal(
                preUpgradeState.nodeInfo[i].isKyced,
                `nodeInfo isKyced mismatch for index ${i}`
            );

            // Verify other mappings
            expect(postUpgradeState.nodeIdToOwner[i]).to.equal(
                preUpgradeState.nodeIdToOwner[i],
                `nodeIdToOwner mismatch for index ${i}`
            );
            expect(postUpgradeState.isNodeBurned[i]).to.equal(
                preUpgradeState.isNodeBurned[i],
                `isNodeBurned mismatch for index ${i}`
            );
            expect(postUpgradeState.lastSnapshotterChange[i]).to.equal(
                preUpgradeState.lastSnapshotterChange[i],
                `lastSnapshotterChange mismatch for index ${i}`
            );
        }

        // Verify new functionality works
        const callResponse = await upgradedNodes.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });
});

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

        await protocolStateProxy.connect(other1).releaseEpoch(
            dataMarket.target,
            1,
            10
        );


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

            // Get validators, sequencers, and admins
            validators: await dataMarket.getValidators(),
            sequencers: await dataMarket.getSequencers(),
            admins: await dataMarket.getAdmins(),

            // Get counts
            totalValidators: await dataMarket.getTotalValidatorsCount(),
            totalSequencers: await dataMarket.getTotalSequencersCount(),
            totalSnapshotters: await dataMarket.getTotalSnapshotterCount()
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

            // Get validators, sequencers, and admins
            validators: await upgradedDataMarket.getValidators(),
            sequencers: await upgradedDataMarket.getSequencers(),
            admins: await upgradedDataMarket.getAdmins(),

            // Get counts
            totalValidators: await upgradedDataMarket.getTotalValidatorsCount(),
            totalSequencers: await upgradedDataMarket.getTotalSequencersCount(),
            totalSnapshotters: await upgradedDataMarket.getTotalSnapshotterCount()
        };

        // Verify all state variables are preserved
        expect(postUpgradeState.sequencerId).to.equal(preUpgradeState.sequencerId);
        expect(postUpgradeState.protocolState).to.equal(preUpgradeState.protocolState);
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

        // Verify arrays are preserved
        expect(postUpgradeState.validators).to.deep.equal(preUpgradeState.validators);
        expect(postUpgradeState.sequencers).to.deep.equal(preUpgradeState.sequencers);
        expect(postUpgradeState.admins).to.deep.equal(preUpgradeState.admins);

        // Verify counts are preserved
        expect(postUpgradeState.totalValidators).to.equal(preUpgradeState.totalValidators);
        expect(postUpgradeState.totalSequencers).to.equal(preUpgradeState.totalSequencers);
        expect(postUpgradeState.totalSnapshotters).to.equal(preUpgradeState.totalSnapshotters);

        const callResponse = await upgradedDataMarket.newFunctionality();
        expect(callResponse).to.equal("This is a new functionality");
    });
});

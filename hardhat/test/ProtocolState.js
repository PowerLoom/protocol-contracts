const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

const errorCodes = require("../contracts/DataMarketErrors.json");
  

describe("PowerloomProtocolState", function () {

    // define accounts
    let owner, 
    snapshotter1, 
    snapshotter2, 
    epochManager, 
    otherAccount1, 
    otherAccount2, 
    otherAccount3,
    sequencer1,
    sequencer2;

    // define contracts
    let snapshotterState,
    dataMarketFactory,
    proxyContract,
    dataMarket1,
    dataMarket2,
    dataMarket1Address, 
    dataMarket2Address;

    // define variables
    let deploymentBlock;
    let dataMarketCount = 0;
    let dataMarketIds = {};
    let epochSize = 10;
    let useBlockNumberAsEpochId = false;

    beforeEach(async function () {
        [
            owner, 
            snapshotter1, 
            snapshotter2, 
            epochManager, 
            otherAccount1, 
            otherAccount2, 
            otherAccount3,
            sequencer1,
            sequencer2
        ] = await ethers.getSigners();

        // Deploy the storage contract
        const SnapshotterState = await ethers.getContractFactory("PowerloomNodes");
        snapshotterState = await upgrades.deployProxy(SnapshotterState, [owner.address, 10000, "Test"]);
        await snapshotterState.waitForDeployment();

        // Deploy the DataMarketFactory contract
        const DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
        dataMarketFactory = await DataMarketFactory.deploy();
        await dataMarketFactory.waitForDeployment();

        // Deploy the proxy contract for PowerloomProtocolState
        const PowerloomProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
        proxyContract = await upgrades.deployProxy(PowerloomProtocolState, [owner.address]);
        await proxyContract.waitForDeployment();

        // Set the snapshotter state address in the protocol state
        const storageChangeTx = await proxyContract.updateSnapshotterState(await snapshotterState.getAddress());
        await storageChangeTx.wait();

        // Set the data market factory address in the protocol state
        const dmFactoryChangeTx = await proxyContract.updateDataMarketFactory(await dataMarketFactory.getAddress());
        await dmFactoryChangeTx.wait();

        deploymentBlock = await time.latestBlock();
        // Increment deployment block to account for mining on deploy tx
        deploymentBlock++;


        const dataMarketTx = await proxyContract.createDataMarket(owner.address, epochSize, 137, 20000, useBlockNumberAsEpochId);
        const receipt = await dataMarketTx.wait();
        expect(receipt.status).to.equal(1);

        const filter = dataMarketFactory.filters.DataMarketCreated();
        let logs = await dataMarketFactory.queryFilter(filter, 0, "latest");
        
        // Parse and display the logs
        logs.forEach((log) => {
            const parsedLog = dataMarketFactory.interface.parseLog(log);
            dataMarket1Address = parsedLog.args.dataMarketAddress;
        });

        // Increment data market count
        dataMarketCount = await proxyContract.dataMarketCount();
        dataMarketIds[dataMarketCount] = dataMarket1Address;

        const dataMarket2Tx = await proxyContract.createDataMarket(owner.address, 1, 137, 20000, false);
        const receiptDM2 = await dataMarket2Tx.wait();
        expect(receiptDM2.status).to.equal(1);
        
        logs = await dataMarketFactory.queryFilter(filter, 0, "latest");
        
        // Parse and display the logs
        logs.forEach((log) => {
            const parsedLog = dataMarketFactory.interface.parseLog(log);
            dataMarket2Address = parsedLog.args.dataMarketAddress;
        });

        // Increment data market count
        dataMarketCount = await proxyContract.dataMarketCount();
        dataMarketIds[dataMarketCount] = dataMarket2Address;

        // Get the event logs
        

        const dataMarketContract = await ethers.getContractFactory("PowerloomDataMarket");
        dataMarket1 = dataMarketContract.attach(dataMarket1Address);
        dataMarket2 = dataMarketContract.attach(dataMarket2Address);

        // Set contract state
        await proxyContract.updateEpochManager(dataMarket1Address, epochManager.address)

        // Set protocol state as snapshotter state admin
        await snapshotterState.updateAdmins([proxyContract.target], [true]);

        epochsInADay = proxyContract.epochsInADay(dataMarket1.target);
    });

    async function generateSignature(account, dsContract, slotId, snapshotCid, epochId, projectId) {
        const domain = {
            name: 'PowerloomDataMarket',
            version: '0.1',
            chainId: 31337,
            verifyingContract: dsContract
        };

        const types = {
            EIPRequest: [
                { name: 'slotId', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
                { name: 'snapshotCid', type: 'string' },
                { name: 'epochId', type: 'uint256' },
                { name: 'projectId', type: 'string' }
            ]
        };

        const data = {
            slotId: slotId,
            deadline: new Date().getTime() + 1000,
            snapshotCid: snapshotCid,
            epochId: epochId,
            projectId: projectId
        };

        const signature = await account.signTypedData(domain, types, data);
        return { data, signature };
    }

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await proxyContract.owner()).to.equal(owner.address);
        });
    });

    describe("Snapshotter State", function () {
        it("should bulk assign snapshotters to slots", async function () {
            // Bulk assign snapshotters to slots
            const legacyConfig = {
                legacyNodeCount: 100,
                legacyNodeInitialClaimPercentage: 200000, // 20%
                legacyNodeCliff: 30,
                legacyNodeValue: ethers.parseEther("1000"),
                legacyNodeVestingDays: 365,
                legacyNodeVestingStart: (await time.latest()) + 86400, // 1 day from now
                legacyTokensSentOnL1: ethers.parseEther("100"),
                legacyNodeNonKycedCooldown: 7 * 86400 // 7 days
            };

            await expect(snapshotterState.configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.emit(snapshotterState, "ConfigurationUpdated")
              .withArgs("LegacyNodesConfig", legacyConfig.legacyNodeCount);

            await expect(snapshotterState.adminMintLegacyNodes(snapshotter1.address, 4, true))
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 1)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 2)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 3)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 4);

            await expect(snapshotterState.assignSnapshotterToNodeBulkAdmin([2, 3], [snapshotter1.address, snapshotter2.address]))
                .to.emit(snapshotterState, "allSnapshottersUpdated")
                .withArgs(snapshotter1.address, true)
                .to.emit(snapshotterState, "allSnapshottersUpdated")
                .withArgs(snapshotter2.address, true);

            const slotInfo2 = await snapshotterState.nodeInfo(2);
            const slotInfo3 = await snapshotterState.nodeInfo(3);

            expect(slotInfo2.snapshotterAddress).to.equal(snapshotter1.address);
            expect(slotInfo3.snapshotterAddress).to.equal(snapshotter2.address);

            // Verify allSnapshotters mapping
            const isSnapshotter1 = await snapshotterState.allSnapshotters(snapshotter1.address);
            expect(isSnapshotter1).to.be.true;
            const isSnapshotter2 = await snapshotterState.allSnapshotters(snapshotter2.address);
            expect(isSnapshotter2).to.be.true;

            const isSnapshotter1Forward = await proxyContract.allSnapshotters(snapshotter1.address);
            expect(isSnapshotter1Forward).to.be.true;
            const isSnapshotter2Forward = await proxyContract.allSnapshotters(snapshotter2.address);
            expect(isSnapshotter2Forward).to.be.true;

            expect(await proxyContract.getTotalSnapshotterCount()).to.equal(2);
        });
    });

    describe("Data Market Protocol State", function () {
        it("Should set the right protocol state proxy address", async function () {
            expect(await dataMarket1.protocolState()).to.equal(proxyContract.target);
        });

        it("Should update protocol state in data market contract", async function () {
            const PowerloomProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
            const newProxyContract = await upgrades.deployProxy(PowerloomProtocolState, [owner.address]);
            await newProxyContract.waitForDeployment();

            const updateTx = await dataMarket1.updateProtocolState(newProxyContract.target);
            await updateTx.wait();

            expect(await dataMarket1.protocolState()).to.equal(newProxyContract.target);
        });
    });

    describe("Release Epoch", function () {

        it("Should fail if epoch manager is not set", async function () {
            // const { proxyContract, dataMarket1 } = await loadFixture(deploy);
            await expect(proxyContract.releaseEpoch(dataMarket1.target, 1, epochSize)).to.be.revertedWith(
                "E05"
            );
            expect(errorCodes["E05"]).to.equal("onlyEpochManager");
        });

        it("Should set epoch manager", async function () {
            // const { proxyContract, dataMarket1, epochManager } = await loadFixture(deploy);
            await expect(proxyContract.updateEpochManager(dataMarket1.target, epochManager.address))
                .to.not.be.reverted
            expect(await proxyContract.epochManager(dataMarket1.target)).to.equal(epochManager.address);
        });

        it("Should fail if end epoch is less than start epoch", async function () {
            // const { proxyContract, dataMarket1, epochManager } = await loadFixture(deploy);
            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, 2, 1)).to.be.revertedWith(
                "E20"
            );
            expect(errorCodes["E20"]).to.equal("Epoch end must be equal or greater than begin!");
        });

        it("Should fail if the epoch size is incorrect", async function () {
            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, 1, 100)).to.be.revertedWith(
                "E21"
            );
            expect(errorCodes["E21"]).to.equal("Epoch size is not correct!");
        });

        it("Should fail if the epoch is not continuous", async function () {
            const dataMarketTx = await proxyContract.createDataMarket(owner.address, epochSize, 137, 20000, useBlockNumberAsEpochId);
            const receipt = await dataMarketTx.wait();
            expect(receipt.status).to.equal(1);

            const filter = dataMarketFactory.filters.DataMarketCreated();
            let logs = await dataMarketFactory.queryFilter(filter, 0, "latest");
            
            // Parse and display the logs
            logs.forEach((log) => {
                const parsedLog = dataMarketFactory.interface.parseLog(log);
                dataMarket3Address = parsedLog.args.dataMarketAddress;
            });

            const dataMarketContract = await ethers.getContractFactory("PowerloomDataMarket");
            dataMarket3 = dataMarketContract.attach(dataMarket3Address);

            await expect(proxyContract.updateEpochManager(dataMarket3.target, epochManager.address))
                .to.not.be.reverted

            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket3.target, 1, 10)).to.not.be.reverted;

            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket3.target, 12, 21)).to.be.revertedWith(
                "E22"
            );
            expect(errorCodes["E22"]).to.equal("Epoch is not continuous!");
        });

        it("Should not revert if end epoch is greater than start epoch", async function () {
            // const { proxyContract, dataMarket1, epochManager } = await loadFixture(deploy);
            await expect(proxyContract.updateEpochManager(dataMarket1.target, epochManager.address))
                .to.not.be.reverted
            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, 1, epochSize)).not.to.be.reverted;
        });

        it("Should release Event if end epoch is greater than start epoch", async function () {
            // const { proxyContract, dataMarket1, epochManager } = await loadFixture(deploy);
            await expect(proxyContract.updateEpochManager(dataMarket1.target, epochManager.address))
                .to.not.be.reverted

            const currentBlock = await ethers.provider.getBlockNumber();
            const timestamp = (await ethers.provider.getBlock(currentBlock)).timestamp;

            await expect(proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, 1, epochSize))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket1.target, 1, 1, epochSize, timestamp + 1);
        });
    });

    describe("Submit Snapshots", function () {
        let slotId, projectId, cid, currentEpoch, currentBlock


        beforeEach(async function () {
            // add otherAccount1 as a snapshotter
            slotId = 1;
            const legacyConfig = {
                legacyNodeCount: 100,
                legacyNodeInitialClaimPercentage: 200000, // 20%
                legacyNodeCliff: 30,
                legacyNodeValue: ethers.parseEther("1000"),
                legacyNodeVestingDays: 365,
                legacyNodeVestingStart: (await time.latest()) + 86400, // 1 day from now
                legacyTokensSentOnL1: ethers.parseEther("100"),
                legacyNodeNonKycedCooldown: 7 * 86400 // 7 days
            };
            await expect(snapshotterState.configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).not.to.be.reverted;
            await expect(snapshotterState.adminMintLegacyNodes(otherAccount1.address, 1, true)).not.to.be.reverted;
            await expect(snapshotterState.assignSnapshotterToNodeAdmin(
                slotId, 
                otherAccount1.address
            )).not.to.be.reverted;

            // add project to data market
            projectId = 'test-project-1';

            currentBlock = await time.latestBlock();
            await proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, currentBlock, currentBlock + epochSize - 1);

            currentEpoch = await proxyContract.currentEpoch(dataMarket1.target);
            cid = 'QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR'
        });

        it("Should return empty string for empty cids in snapshot", async function () {
            expect(await proxyContract.maxSnapshotsCid(dataMarket1.target, projectId, currentEpoch.epochId)).to.equal("");
        });

        it("Should set the project first epoch id on batch submission", async function () {
            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const batchId = 1;
            const projectIds = ["first-epoch-test-project"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");
            const epochId = currentEpoch.epochId;

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).to.not.be.reverted;

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            expect(await proxyContract.projectFirstEpochId(dataMarket1.target, projectIds[0])).to.equal(epochId);
            expect(await proxyContract.lastSequencerFinalizedSnapshot(dataMarket1.target, projectIds[0])).to.equal(epochId);
        });

        it("Batch submission should fail if submitted again", async function () {
            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const batchId = 1;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");
            const epochId = currentEpoch.epochId;

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).to.not.be.reverted;

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const project1Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            const project2Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[1], epochId);

            expect(project1Status.status).to.equal(0);
            expect(project2Status.status).to.equal(0);
            expect(project1Status.snapshotCid).to.equal(snapshotCids[0]);
            expect(project2Status.snapshotCid).to.equal(snapshotCids[1]);

            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.be.revertedWith("E25");

            expect(errorCodes["E25"]).to.equal("Snapshot for this project and epoch already exists!");

        });

        it("Should fail if the project ids and snapshot cids length mismatch", async function () {
            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const batchId = 1;
            const projectIds = ["test-project-1"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");
            const epochId = currentEpoch.epochId;

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).to.not.be.reverted;

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.be.revertedWith("E23");
            expect(errorCodes["E23"]).to.equal("projectIds and snapshotCids length mismatch!");

            const noProjectIds = [];
            const noSnapshotCids = [];

            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                noProjectIds, 
                noSnapshotCids, 
                finalizedRootHash
            )).to.be.revertedWith("E24");
            expect(errorCodes["E24"]).to.equal("projectIds and snapshotCids length cannot be zero!");
        });

        it("Should store batch attestations successfully", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            const blockTimestamp = await time.latest();

            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1); 

            const project1Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            const project2Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[1], epochId);

            expect(project1Status.status).to.equal(0);
            expect(project2Status.status).to.equal(0);
            expect(project1Status.snapshotCid).to.equal(snapshotCids[0]);
            expect(project2Status.snapshotCid).to.equal(snapshotCids[1]);
        });

        it("Should finalize batch on enough batch attestations", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const project1Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            const project2Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[1], epochId);

            expect(project1Status.status).to.equal(0);
            expect(project2Status.status).to.equal(0);
            expect(project1Status.snapshotCid).to.equal(snapshotCids[0]);
            expect(project2Status.snapshotCid).to.equal(snapshotCids[1]);

            // set otherAccount1 and otherAccount2 as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address], 
                [true, true],
            );

            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
            
            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(dataMarket1, "SnapshotBatchFinalized")
                .withArgs(epochId, batchCid, blockTimestamp + 2);

            const project1StateAfterAttestation = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            const project2StateAfterAttestation = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[1], epochId);

            expect(project1StateAfterAttestation.status).to.equal(1);
            expect(project2StateAfterAttestation.status).to.equal(1);
            expect(project1StateAfterAttestation.snapshotCid).to.equal(snapshotCids[0]);
            expect(project2StateAfterAttestation.snapshotCid).to.equal(snapshotCids[1]);

            expect(await proxyContract.lastFinalizedSnapshot(dataMarket1.target, projectIds[0])).to.equal(epochId);
            expect(await proxyContract.maxSnapshotsCid(dataMarket1.target, projectIds[1], epochId)).to.equal(snapshotCids[1]);
            expect(await proxyContract.batchCidAttestationStatus(dataMarket1.target, batchCid)).to.equal(true);
        });

        it("Should correctly handle consensus for attestations", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set otherAccount1 and otherAccount2 as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address], 
                [true, true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 2)).not.to.be.reverted;

            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
            expect(await proxyContract.checkDynamicConsensusAttestations(dataMarket1.target, batchCid, epochId)).to.be.false;
            expect(await proxyContract.maxAttestationsCount(dataMarket1.target, batchCid)).to.equal(1);

            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(dataMarket1, "SnapshotBatchFinalized")
                .withArgs(epochId, batchCid, blockTimestamp + 2)
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 2, otherAccount2.address);

            expect(await proxyContract.maxAttestationsCount(dataMarket1.target, batchCid)).to.equal(2);
            expect(await proxyContract.minAttestationsForConsensus(dataMarket1.target)).to.equal(2);
            expect(await proxyContract.attestationsReceivedCount(dataMarket1.target, batchCid, finalizedRootHash)).to.equal(2);
            expect(await proxyContract.maxAttestationFinalizedRootHash(dataMarket1.target, batchCid)).to.equal(finalizedRootHash);
            expect(await proxyContract.attestationsReceived(dataMarket1.target, batchCid, otherAccount2.address)).to.be.true;
        });

        it("Should force consensus for attestations", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set 3 accounts as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address, otherAccount3.address], 
                [true, true, true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 1)).not.to.be.reverted;
            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
            expect(await proxyContract.checkDynamicConsensusAttestations(dataMarket1.target, batchCid, epochId)).to.be.false;

            // pass time beyond minAttestationWindow
            const window = await proxyContract.attestationSubmissionWindow(dataMarket1.target);
            await mine(window + 1n);

            currentBlock = await time.latestBlock();
            const epochInfo = await proxyContract.epochInfo(dataMarket1.target, epochId);
            expect(epochInfo.blocknumber + window).to.be.lessThan(currentBlock);
            
            expect(await proxyContract.checkDynamicConsensusAttestations(dataMarket1.target, batchCid, epochId)).to.be.true;
            blockTimestamp = await time.latest();
            await expect(proxyContract.forceCompleteConsensusAttestations(dataMarket1.target, batchCid, epochId))
                .to.emit(dataMarket1, "SnapshotBatchFinalized")
                .withArgs(epochId, batchCid, blockTimestamp + 1)
                .to.emit(proxyContract, "SnapshotBatchFinalized")
                .withArgs(dataMarket1.target, epochId, batchCid, blockTimestamp + 1);
        });

        it("Should fail to submit batch attestation if batch cid is not submitted", async function () {
            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set otherAccount1 as a validator
            const role = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.be.revertedWith("E26");
            expect(errorCodes["E26"]).to.equal("batch ID does not belong to epoch ID");
        });

        it("Should properly handle delayed submissions", async function () {
            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");
            const epochId = currentEpoch.epochId;

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).to.not.be.reverted;
            // pass time beyond batchSubmissionWindow
            const window = await proxyContract.batchSubmissionWindow(dataMarket1.target);
            await mine(window + 1n);

            currentBlock = await time.latestBlock();
            const epochInfo = await proxyContract.epochInfo(dataMarket1.target, epochId);
            expect(epochInfo.blocknumber + window).to.be.lessThan(currentBlock);

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash))
                .to.emit(proxyContract, "DelayedBatchSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1)
                .to.emit(dataMarket1, "DelayedBatchSubmitted")
                .withArgs(batchCid, epochId, blockTimestamp + 1);
        });

        it("Should properly handle delayed attestations", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );
            
            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set 3 accounts as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address, otherAccount3.address], 
                [true, true, true],
            );

            // pass time beyond minAttestationWindow
            const window = await proxyContract.attestationSubmissionWindow(dataMarket1.target);
            await mine(window + 1n);

            currentBlock = await time.latestBlock();
            const epochInfo = await proxyContract.epochInfo(dataMarket1.target, epochId);
            expect(epochInfo.blocknumber + window).to.be.lessThan(currentBlock);

            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "DelayedAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address)
                .to.emit(dataMarket1, "DelayedAttestationSubmitted")
                .withArgs(batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
        });

        it("Should properly handle divergent validators", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set 3 accounts as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address, otherAccount3.address], 
                [true, true, true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 2)).not.to.be.reverted;

            const divergentRootHash = ethers.encodeBytes32String("divergent-hash");
            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, divergentRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
            
            expect(await proxyContract.batchCidDivergentValidators(dataMarket1.target, batchCid, 0)).to.equal(otherAccount1.address);

            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 2, otherAccount2.address);

            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestampBefore = blockBefore.timestamp + 1;

            expect(await proxyContract.batchCidDivergentValidators(dataMarket1.target, batchCid, 0)).to.equal(otherAccount1.address);
            expect(await dataMarket1.batchCidDivergentValidatorsLen(batchCid)).to.equal(1);

            // need 3rd attestation to finalize
            await expect(proxyContract.connect(otherAccount3).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 3, otherAccount3.address)
                .to.emit(dataMarket1, "SnapshotBatchFinalized")
                .withArgs(epochId, batchCid, blockTimestamp + 3)
                .to.emit(dataMarket1, "ValidatorAttestationsInvalidated")
                .withArgs(epochId, batchCid, otherAccount1.address, timestampBefore);
        });

        it("Should correctly force complete consensus attestation with divergent validators", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set 3 accounts as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address, otherAccount3.address], 
                [true, true, true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 2)).not.to.be.reverted;

            const divergentRootHash = ethers.encodeBytes32String("divergent-hash");
            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, divergentRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);
            
            expect(await proxyContract.batchCidDivergentValidators(dataMarket1.target, batchCid, 0)).to.equal(otherAccount1.address);

            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 2, otherAccount2.address);

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);
            let timestampBefore = blockBefore.timestamp + 1;

            expect(await proxyContract.batchCidDivergentValidators(dataMarket1.target, batchCid, 0)).to.equal(otherAccount1.address);
            expect(await dataMarket1.batchCidDivergentValidatorsLen(batchCid)).to.equal(1);

            const batchCidToProjectIds = await proxyContract.batchCidToProjects(dataMarket1.target, batchCid);
            expect(batchCidToProjectIds[0]).to.equal(projectIds[0]);
            expect(batchCidToProjectIds[1]).to.equal(projectIds[1]);
            expect(await dataMarket1.batchCidToProjectsLen(batchCid)).to.equal(2);

            const snapshotStatus = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            expect(snapshotStatus.status).to.equal(0);
            expect(snapshotStatus.snapshotCid).to.equal(snapshotCids[0]);

            const epochInfo = await dataMarket1.epochInfo(epochId);
            const epochEnd = epochInfo.epochEnd;

            blockNumBefore = await ethers.provider.getBlockNumber();
            blockBefore = await ethers.provider.getBlock(blockNumBefore);
            timestampBefore = blockBefore.timestamp + 1;

            await expect(proxyContract.forceCompleteConsensusAttestations(dataMarket1.target, batchCid, epochId))
                .to.emit(proxyContract, "SnapshotFinalized")
                .withArgs(dataMarket1.target, epochId, epochEnd, projectIds[0], snapshotCids[0], blockTimestamp + 3)
                .to.emit(proxyContract, "SnapshotFinalized")
                .withArgs(dataMarket1.target, epochId, epochEnd, projectIds[1], snapshotCids[1], blockTimestamp + 3)
                .to.emit(proxyContract, "ValidatorAttestationsInvalidated")
                .withArgs(dataMarket1.target, epochId, batchCid, otherAccount1.address, timestampBefore);
        });

        it("Should trigger resubmission if validators are divergent", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            // set 3 accounts as validators
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address, otherAccount2.address, otherAccount3.address], 
                [true, true, true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 2)).not.to.be.reverted;

            const divergentRootHash = ethers.encodeBytes32String("divergent-hash");
            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1, otherAccount1.address);

            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(dataMarket1.target, batchCid, epochId, divergentRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 2, otherAccount2.address);
            
            await expect(proxyContract.connect(otherAccount3).submitBatchAttestation(dataMarket1.target, batchCid, epochId, divergentRootHash))
                .to.emit(proxyContract, "SnapshotBatchAttestationSubmitted")
                .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 3, otherAccount3.address)
                .to.emit(dataMarket1, "TriggerBatchResubmission")
                .withArgs(epochId, batchCid, blockTimestamp + 3);

            mine(100); // mine 100 blocks to pass the attestationSubmissionWindow

            blockTimestamp = await time.latest();
            await expect(proxyContract.forceCompleteConsensusAttestations(dataMarket1.target, batchCid, epochId))
                .to.emit(proxyContract, "TriggerBatchResubmission")
                .withArgs(dataMarket1.target, epochId, batchCid, blockTimestamp + 1)
                .to.emit(dataMarket1, "TriggerBatchResubmission")
                .withArgs(epochId, batchCid, blockTimestamp + 1);
        });

        it("Should store batchId to projectIds mapping", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const batchCidToProjects = await proxyContract.batchCidToProjects(dataMarket1.target, batchCid);

            expect(batchCidToProjects[0]).to.equal(projectIds[0]);
            expect(batchCidToProjects[1]).to.equal(projectIds[1]);
            expect(await dataMarket1.batchCidToProjectsLen(batchCid)).to.equal(2);
        });

        it("Should store the correct consensus data for different types of finalization", async function () {
            const PENDING = 0;
            const FINALIZED = 1;
            const FALLBACK_FINALIZED = 2;

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const project1Status = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            expect(project1Status.status).to.equal(PENDING);

            // set otherAccount1 as a validator
            const role2 = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address], 
                [true],
            );

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 1)).not.to.be.reverted;

            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).submitBatchAttestation(dataMarket1.target, batchCid, epochId, finalizedRootHash))
                .to.emit(dataMarket1, "SnapshotBatchFinalized")
                .withArgs(epochId, batchCid, blockTimestamp + 1);
            const project1StatusAfterAttestation = await proxyContract.snapshotStatus(dataMarket1.target, projectIds[0], epochId);
            expect(project1StatusAfterAttestation.status).to.equal(FINALIZED);
            expect(project1StatusAfterAttestation.snapshotCid).to.equal(snapshotCids[0]);
            
        });

        it("Should handle batch submissions with partial duplicates", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const duplicateProjectIds = ["test-project-1", "test-project-3"];
            const duplicateCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnT"];

            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                duplicateProjectIds, 
                duplicateCids, 
                finalizedRootHash
            )).to.be.revertedWith("E25");
            expect(errorCodes["E25"]).to.equal("Snapshot for this project and epoch already exists!");

            const duplicateProjectIds2 = ["test-project-4", "test-project-4"];
            const duplicateCids2 = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnU", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnU"];

            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                duplicateProjectIds2, 
                duplicateCids2, 
                finalizedRootHash
            )).to.be.revertedWith("E25");
            expect(errorCodes["E25"]).to.equal("Snapshot for this project and epoch already exists!");
        });

        it("Should store epochId to batchIds mapping", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const epochIdToBatchIds = await proxyContract.epochIdToBatchCids(dataMarket1.target, epochId);
            expect(epochIdToBatchIds[0]).to.equal(batchCid);
            expect(epochIdToBatchIds.length).to.equal(1);

        });

        it("Should store the correct batchCid after sequencer submission", async function () {
            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 100)).not.to.be.reverted;

            const batchCid = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnX";
            const epochId = currentEpoch.epochId;
            const projectIds = ["test-project-1", "test-project-2"];
            const snapshotCids = ["QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR", "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"];
            const finalizedRootHash = ethers.encodeBytes32String("test-hash");

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).submitSubmissionBatch(
                dataMarket1.target, 
                batchCid,
                epochId, 
                projectIds, 
                snapshotCids, 
                finalizedRootHash
            )).to.emit(proxyContract, "SnapshotBatchSubmitted")
              .withArgs(dataMarket1.target, batchCid, epochId, blockTimestamp + 1);

            const batchCidSequencerAttestation = await proxyContract.batchCidSequencerAttestation(dataMarket1.target, batchCid);
            expect(batchCidSequencerAttestation).to.equal(finalizedRootHash);
        });

        it("Should end batch submissions", async function () {

            // set sequencer1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [sequencer1.address], 
                [true],
            );
            
            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(sequencer1).endBatchSubmissions(dataMarket1.target, currentEpoch.epochId))
                .to.emit(proxyContract, "BatchSubmissionsCompleted")
                .withArgs(dataMarket1.target, currentEpoch.epochId, blockTimestamp + 1);

            const completed = await dataMarket1.epochIdToBatchSubmissionsCompleted(currentEpoch.epochId);
            expect(completed).to.equal(true);

            await expect(proxyContract.connect(sequencer1).endBatchSubmissions(dataMarket1.target, currentEpoch.epochId))
                .to.be.revertedWith("E39");
            expect(errorCodes["E39"]).to.equal("Batch submissions completed for this epoch");
        });

    });

    describe("Rewards", function () {
        beforeEach(async function () {
            // Assign snapshotters to slots in both data markets
            const legacyConfig = {
                legacyNodeCount: 100,
                legacyNodeInitialClaimPercentage: 200000, // 20%
                legacyNodeCliff: 30,
                legacyNodeValue: ethers.parseEther("1000"),
                legacyNodeVestingDays: 365,
                legacyNodeVestingStart: (await time.latest()) + 86400, // 1 day from now
                legacyTokensSentOnL1: ethers.parseEther("100"),
                legacyNodeNonKycedCooldown: 7 * 86400 // 7 days
            };
            await expect(snapshotterState.configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.emit(snapshotterState, "ConfigurationUpdated")
              .withArgs("LegacyNodesConfig", legacyConfig.legacyNodeCount);
            await expect(snapshotterState.adminMintLegacyNodes(snapshotter1.address, 2, true))
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 2)
            await expect(snapshotterState.assignSnapshotterToNodeBulkAdmin(
                [1, 2], 
                [otherAccount1.address, otherAccount2.address]
            )).to.emit(snapshotterState, "allSnapshottersUpdated")
              .withArgs(otherAccount1.address, true)
              .to.emit(snapshotterState, "allSnapshottersUpdated")
              .withArgs(otherAccount2.address, true);
    
            await proxyContract.updateAddresses(dataMarket1.target, 1, [sequencer1.address], [true]); // set sequencer1 as a sequencer
            await proxyContract.updateAddresses(dataMarket2.target, 1, [sequencer2.address], [true]); // set sequencer2 as a sequencer

        });


        it("Should return correct rewards sum", async function () {
            // Set some reward points and snapshot counts for dataMarket1
            let eligibleNodes = 2;
            const rewardBasePoints = 100;
            const snapshotQuota = 5;
            
            await proxyContract.updateRewardPoolSize(dataMarket1.target, rewardBasePoints);
            await proxyContract.updateDailySnapshotQuota(dataMarket1.target, snapshotQuota);
            await dataMarket1.connect(sequencer1).updateEligibleNodesForDay(1, eligibleNodes);

            const slot1Dm1Submissions = 8;
            const slot2Dm1Submissions = 6;

            // Set some reward points and snapshot counts for dataMarket1 - slots 1 and 2, submissions 8 and 6 respectively
            await proxyContract.connect(sequencer1).updateRewards(dataMarket1.target, [1, 2], [slot1Dm1Submissions, slot2Dm1Submissions], 1, eligibleNodes);
    
            // Set some reward points and snapshot counts for dataMarket2
            await proxyContract.updateRewardPoolSize(dataMarket2.target, rewardBasePoints);
            await proxyContract.updateDailySnapshotQuota(dataMarket2.target, snapshotQuota);
            
            const slot1Dm2Submissions = 9;
            const slot2Dm2Submissions = 3;

            eligibleNodes = 1;
            await dataMarket2.connect(sequencer2).updateEligibleNodesForDay(1, eligibleNodes);
            // Set some reward points and snapshot counts for dataMarket2 - slots 4 and 5, submissions and 3 respectively
            await proxyContract.connect(sequencer2).updateRewards(dataMarket2.target, [1, 2], [slot1Dm2Submissions, slot2Dm2Submissions], 1, eligibleNodes);
            const expectedRewardsSlot1 = 150; // 50 for dataMarket1 + 100 for dataMarket2
            const expectedRewardsSlot2 = 50; // 50 for dataMarket1

            // Check total rewards for each slot
            const slot1Dm1Rewards = await proxyContract.getSlotRewards(1);
            const slot2Dm1Rewards = await proxyContract.getSlotRewards(2);
            expect(slot1Dm1Rewards).to.equal(expectedRewardsSlot1);
            expect(slot2Dm1Rewards).to.equal(expectedRewardsSlot2);

            // Check data market state
            const expectedEligibleRewardsDM1 = 50; // 100 / 2 eligible nodes
            const expectedEligibleRewardsDM2 = 100; // 100 / 1 eligible node

            const dm1SlotInfo1 = await dataMarket1.getSlotInfo(1);
            const dm1SlotInfo2 = await dataMarket1.getSlotInfo(2);
            const dm2SlotInfo1 = await dataMarket2.getSlotInfo(1);
            const dm2SlotInfo2 = await dataMarket2.getSlotInfo(2);

            expect(dm1SlotInfo1.rewardPoints).to.equal(expectedEligibleRewardsDM1);
            expect(dm1SlotInfo2.rewardPoints).to.equal(expectedEligibleRewardsDM1);
            expect(dm2SlotInfo1.rewardPoints).to.equal(expectedEligibleRewardsDM2);
            expect(dm2SlotInfo2.rewardPoints).to.equal(0);

            // Check submission counts
            expect(dm1SlotInfo1.currentDaySnapshotCount).to.equal(8);
            expect(dm1SlotInfo2.currentDaySnapshotCount).to.equal(6);
            expect(dm2SlotInfo1.currentDaySnapshotCount).to.equal(9);
            expect(dm2SlotInfo2.currentDaySnapshotCount).to.equal(3);

            // Check reward pool size and daily snapshot quota
            expect(await dataMarket1.rewardPoolSize()).to.equal(100);
            expect(await dataMarket2.rewardPoolSize()).to.equal(100);
            expect(await dataMarket1.dailySnapshotQuota()).to.equal(5);
            expect(await dataMarket2.dailySnapshotQuota()).to.equal(5);

            // Check eligible nodes for the day
            expect(await dataMarket1.eligibleNodesForDay(1)).to.equal(2);
            expect(await dataMarket2.eligibleNodesForDay(1)).to.equal(1);
        });

        it("Should store rewards successfully", async function () {
            await expect(proxyContract.updateRewardPoolSize(dataMarket1.target, 100)).not.to.be.reverted;
            expect(await proxyContract.rewardPoolSize(dataMarket1.target)).to.be.equal(100);

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            const eligibleNodesForDayBefore = await dataMarket1.eligibleNodesForDay(1);
            expect(eligibleNodesForDayBefore).to.equal(0);

            const blockTimestamp1 = await time.latest();
            const dailySnapshotQuota = await proxyContract.dailySnapshotQuota(dataMarket1.target);

            // test sending 0 eligible nodes
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [1], 
                [dailySnapshotQuota], 
                1,
                0
            )).to.not.be.reverted;

            // test that rewards are not distributed
            expect(await proxyContract.slotRewardPoints(dataMarket1.target, 1)).to.equal(0);

            await dataMarket1.connect(otherAccount1).updateEligibleNodesForDay(1, 1);

            const rewardPoolSize = await dataMarket1.rewardPoolSize();
            const eligibleNodesForDayAfter = await dataMarket1.eligibleNodesForDay(1);
            const expectedRewardPoints = rewardPoolSize / eligibleNodesForDayAfter;

            const blockTimestamp2 = await time.latest();
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [1], 
                [dailySnapshotQuota], 
                1,
                1
            )).to.emit(proxyContract, "RewardsDistributedEvent")
            .withArgs(dataMarket1.target, otherAccount1.address, 1, 1, expectedRewardPoints, blockTimestamp2 + 1);

            expect(await proxyContract.slotRewardPoints(dataMarket1.target, 1)).to.equal(expectedRewardPoints);
            expect(await proxyContract.slotSubmissionCount(dataMarket1.target, 1, 1)).to.equal(dailySnapshotQuota);
        });

        it("Should successfully claim rewards", async function () {
            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            const rewardPoolSize = ethers.parseEther("100");
            await expect(dataMarket1.connect(owner).updateRewardPoolSize(rewardPoolSize)).to.not.be.reverted;

            // send rewards for distribution
            await owner.sendTransaction({
                to: proxyContract.target,
                value: ethers.parseEther("100")
            });

            const eligibleNodesForDay = 2;
            const expectedRewardPoints = BigInt(rewardPoolSize) / BigInt(eligibleNodesForDay);

            const dailySnapshotQuota = await proxyContract.dailySnapshotQuota(dataMarket1.target);
            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [1, 2], 
                [dailySnapshotQuota, dailySnapshotQuota], 
                1,
                eligibleNodesForDay
            )).to.emit(proxyContract, "RewardsDistributedEvent")
            .withArgs(dataMarket1.target, otherAccount1.address, 1, 1, expectedRewardPoints, blockTimestamp + 1)
            .withArgs(dataMarket1.target, otherAccount2.address, 2, 1, expectedRewardPoints, blockTimestamp + 1);

            expect(await dataMarket1.eligibleNodesForDay(1)).to.equal(2);
            expect(await dataMarket1.rewardPoolSize()).to.equal(rewardPoolSize);

            const totalNodesHeld = await snapshotterState.getUserOwnedNodeIds(snapshotter1.address);
            const totalRewards = BigInt(totalNodesHeld.length) * BigInt(expectedRewardPoints);

            const contractBalanceBefore = await ethers.provider.getBalance(proxyContract.target);
            // claim rewards to node holder of slot 1
            await expect(proxyContract.connect(snapshotter1).claimRewards(snapshotter1.address))
                .to.emit(proxyContract, "RewardsClaimed")
                .withArgs(snapshotter1.address, totalRewards, blockTimestamp + 2);

            const contractBalanceAfter = await ethers.provider.getBalance(proxyContract.target);
            expect(contractBalanceAfter).to.be.equal(contractBalanceBefore - totalRewards);
        });

        it("Should successfully claim rewards from multiple data markets", async function () {
            const rewardPoolSize = ethers.parseEther("100");
            await expect(dataMarket1.connect(owner).updateRewardPoolSize(rewardPoolSize)).to.not.be.reverted;
            await expect(dataMarket2.connect(owner).updateRewardPoolSize(rewardPoolSize)).to.not.be.reverted;

            await proxyContract.updateAddresses(
                dataMarket1.target,
                1,
                [otherAccount1.address], 
                [true],
            );

            await proxyContract.updateAddresses(
                dataMarket2.target,
                1,
                [otherAccount1.address], 
                [true],
            );

            // send rewards for distribution
            await owner.sendTransaction({
                to: proxyContract.target,
                value: rewardPoolSize * 2n
            });

            const eligibleNodesForDay = 2;
            const expectedRewardPoints = BigInt(rewardPoolSize) / BigInt(eligibleNodesForDay);

            const dailySnapshotQuota1 = await proxyContract.dailySnapshotQuota(dataMarket1.target);
            const dailySnapshotQuota2 = await proxyContract.dailySnapshotQuota(dataMarket2.target);
            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [1, 2], 
                [dailySnapshotQuota1, dailySnapshotQuota1], 
                1,
                eligibleNodesForDay
            )).to.emit(proxyContract, "RewardsDistributedEvent")
            .withArgs(dataMarket1.target, otherAccount1.address, 1, 1, expectedRewardPoints, blockTimestamp + 1)
            .withArgs(dataMarket1.target, otherAccount2.address, 2, 1, expectedRewardPoints, blockTimestamp + 1);

            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket2.target, 
                [1, 2], 
                [dailySnapshotQuota2, dailySnapshotQuota2], 
                1,
                eligibleNodesForDay
            )).to.emit(proxyContract, "RewardsDistributedEvent")
            .withArgs(dataMarket2.target, otherAccount1.address, 1, 1, expectedRewardPoints, blockTimestamp + 2)
            .withArgs(dataMarket2.target, otherAccount2.address, 2, 1, expectedRewardPoints, blockTimestamp + 2);

            const totalNodesHeld = await snapshotterState.getUserOwnedNodeIds(snapshotter1.address);
            const totalRewards = BigInt(totalNodesHeld.length) * BigInt(expectedRewardPoints);
            const totalRewardsForBothMarkets = totalRewards * 2n;

            const contractBalanceBefore = await ethers.provider.getBalance(proxyContract.target);
            // claim rewards to node holder of slot 1
            await expect(proxyContract.connect(snapshotter1).claimRewards(snapshotter1.address))
                .to.emit(proxyContract, "RewardsClaimed")
                .withArgs(snapshotter1.address, totalRewardsForBothMarkets, blockTimestamp + 3);

            const contractBalanceAfter = await ethers.provider.getBalance(proxyContract.target);
            expect(contractBalanceAfter).to.be.equal(contractBalanceBefore - totalRewardsForBothMarkets);

        });
    });

    describe("Protocol State Getters/Setters", function () {
        
        it("Should toggle data market active status", async function () {
            expect(await proxyContract.toggleDataMarket(dataMarket1.target, false))
                .to.not.be.reverted;
            let marketInfo = await proxyContract.dataMarkets(dataMarket1.target);
            expect(marketInfo.enabled).to.be.false;

            await expect(proxyContract.toggleDataMarket(dataMarket1.target, true))
                .to.not.be.reverted;
            const enabled = await proxyContract.dataMarketEnabled(dataMarket1.target);
            expect(enabled).to.be.true;
        });

        it("Should fail to update addresses if role is invalid", async function () {
            await expect(proxyContract.updateAddresses(
                dataMarket1.target,
                3,
                [otherAccount1.address],
                [true],
            )).to.be.reverted;
        });

        it("Should fail to update addresses if array length is invalid", async function () {
            await expect(proxyContract.updateAddresses(
                dataMarket1.target,
                1,
                [otherAccount1.address],
                [true, true],
            )).to.be.revertedWith("E19");
            expect(errorCodes["E19"]).to.equal("Input lengths do not match");
        });

        it("Should get total snapshotter count correctly", async function () {
            const legacyConfig = {
                legacyNodeCount: 100,
                legacyNodeInitialClaimPercentage: 200000, // 20%
                legacyNodeCliff: 30,
                legacyNodeValue: ethers.parseEther("1000"),
                legacyNodeVestingDays: 365,
                legacyNodeVestingStart: (await time.latest()) + 86400, // 1 day from now
                legacyTokensSentOnL1: ethers.parseEther("100"),
                legacyNodeNonKycedCooldown: 7 * 86400 // 7 days
            };
            await expect(snapshotterState.configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.emit(snapshotterState, "ConfigurationUpdated")
              .withArgs("LegacyNodesConfig", legacyConfig.legacyNodeCount);
            await expect(snapshotterState.adminMintLegacyNodes(snapshotter1.address, 4, true))
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 1)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 2)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 3)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(snapshotter1.address, 4);

            expect(await proxyContract.getTotalSnapshotterCount()).to.be.equal(0);

            // check total node count after minting legacy nodes
            expect(await proxyContract.getTotalNodeCount()).to.be.equal(4);

            // check enabled node count before assigning snapshotters to nodes
            expect(await proxyContract.enabledNodeCount()).to.be.equal(0);

            // assign snapshotters to nodes
            await expect(snapshotterState.assignSnapshotterToNodeBulkAdmin(
                [1, 2, 3, 4], 
                [otherAccount1.address, otherAccount1.address, otherAccount2.address, otherAccount2.address]
            )).to.emit(snapshotterState, "allSnapshottersUpdated")
              .withArgs(otherAccount1.address, true)
              .to.emit(snapshotterState, "allSnapshottersUpdated")
              .withArgs(otherAccount2.address, true);

            // check enabled node count after assigning snapshotters to nodes
            expect(await proxyContract.enabledNodeCount()).to.be.equal(4);

            // check total snapshotter count after assigning snapshotters to nodes
            expect(await proxyContract.getTotalSnapshotterCount()).to.be.equal(4);
        });

        it("Should succesfully remove addresses", async function () {
            await expect(proxyContract.updateAddresses(
                dataMarket1.target,
                1,
                [otherAccount1.address],
                [true],
            )).to.emit(proxyContract, "SequencersUpdated")
              .withArgs(dataMarket1.target, otherAccount1.address, true);

            await expect(proxyContract.updateAddresses(
                dataMarket1.target,
                1,
                [otherAccount1.address],
                [false],
            )).to.emit(proxyContract, "SequencersUpdated")
              .withArgs(dataMarket1.target, otherAccount1.address, false);

            const totalSequencers = await proxyContract.getTotalSequencersCount(dataMarket1.target);
            expect(totalSequencers).to.be.equal(0);
        
        });

        it("Should update the protocol state contract addresses", async function () {
            await expect(proxyContract.updateDataMarketFactory(otherAccount1.address))
                .to.not.be.reverted;
            expect(await proxyContract.dataMarketFactory()).to.equal(otherAccount1.address);

            await expect(proxyContract.updateSnapshotterState(otherAccount2.address))
                .to.not.be.reverted;
            expect(await proxyContract.snapshotterState()).to.equal(otherAccount2.address);

        });

        it("Should successfully update the data market storage mappings", async function () {
            // two markets are deployed in the beforeEach
            expect(await proxyContract.dataMarketCount()).to.be.equal(2);

            const currentCount = await proxyContract.dataMarketCount();
            const storedAddress = dataMarketIds[currentCount];
            expect(await proxyContract.dataMarketIdToAddress(currentCount)).to.equal(storedAddress);

            const dataMarketInfo = await proxyContract.dataMarkets(storedAddress)
            expect(dataMarketInfo.ownerAddress).to.equal(owner.address);
            expect(dataMarketInfo.epochSize).to.equal(1);
            expect(dataMarketInfo.sourceChainId).to.equal(137);
            expect(dataMarketInfo.sourceChainBlockTime).to.equal(20000);
            expect(dataMarketInfo.useBlockNumberAsEpochId).to.be.false;
            expect(dataMarketInfo.enabled).to.be.true;
            expect(dataMarketInfo.dataMarketAddress).to.equal(dataMarket2.target);
            expect(dataMarketInfo.createdAt).to.be.greaterThan(0);
        });

    });

    describe("Data Market Getters/Setters", function () {

        let slotId, currentBlock, projectId, slotCount;

        beforeEach(async function () {
            // add otherAccount1 as a snapshotter
            slotId = 1;
            const legacyConfig = {
                legacyNodeCount: 100,
                legacyNodeInitialClaimPercentage: 200000, // 20%
                legacyNodeCliff: 30,
                legacyNodeValue: ethers.parseEther("1000"),
                legacyNodeVestingDays: 365,
                legacyNodeVestingStart: (await time.latest()) + 86400, // 1 day from now
                legacyTokensSentOnL1: ethers.parseEther("100"),
                legacyNodeNonKycedCooldown: 7 * 86400 // 7 days
            };
            await expect(snapshotterState.configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.emit(snapshotterState, "ConfigurationUpdated")
              .withArgs("LegacyNodesConfig", legacyConfig.legacyNodeCount);

            await expect(snapshotterState.adminMintLegacyNodes(otherAccount1.address, 4, true))
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(otherAccount1.address, 1)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(otherAccount1.address, 2)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(otherAccount1.address, 3)
                .to.emit(snapshotterState, "NodeMinted")
                .withArgs(otherAccount1.address, 4);

            await expect(snapshotterState.assignSnapshotterToNodeBulkAdmin(
                [1], 
                [otherAccount1.address]
            )).to.emit(snapshotterState, "allSnapshottersUpdated")
              .withArgs(otherAccount1.address, true);
            slotCount = 1;

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            const currentEpoch = await proxyContract.currentEpoch(dataMarket1.target);
            await proxyContract.connect(epochManager).releaseEpoch(dataMarket1.target, currentEpoch.end + 1n, currentEpoch.end + BigInt(epochSize) );

            await proxyContract.updateSnapshotSubmissionWindow(dataMarket1.target, 10);
            cid = 'QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR';
            projectId = 'test-project-1';
        });

        it("Should update data market roles", async function () {
            // set otherAccount1 as a validator
            const role = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );
            expect(await proxyContract.getTotalValidatorsCount(dataMarket1.target)).to.be.equal(1);

            // set otherAccount1 as a sequencer
            const role1 = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role1,
                [otherAccount1.address], 
                [true],
            );
            expect(await proxyContract.getTotalSequencersCount(dataMarket1.target)).to.be.equal(1);

            // set otherAccount1 as an admin
            const role2 = 2
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role2,
                [otherAccount1.address], 
                [true],
            );
            expect((await dataMarket1.getAdmins()).length).to.be.equal(1);

            // set otherAccount1 as a non-valid role - will revert silently due to solidity enum checking
            const role3 = 3
            await expect(proxyContract.updateAddresses(
                dataMarket1.target,
                role3,
                [otherAccount1.address], 
                [true],
            )).to.be.reverted;
        });

        it("Should update day size", async function () {
            await expect(proxyContract.updateDaySize(dataMarket1.target, 100)).not.to.be.reverted;
            expect(await proxyContract.DAY_SIZE(dataMarket1.target)).to.be.equal(100);
        });

        it("Should get and update data market state", async function () {
            expect(await proxyContract.deploymentBlockNumber(dataMarket1.target)).to.equal(deploymentBlock);

            await expect(proxyContract.updateMinAttestationsForConsensus(dataMarket1.target, 10)).not.to.be.reverted;
            expect(await proxyContract.minAttestationsForConsensus(dataMarket1.target)).to.be.equal(10);

            await expect(proxyContract.updateSnapshotSubmissionWindow(dataMarket1.target, 10)).not.to.be.reverted;
            expect(await proxyContract.snapshotSubmissionWindow(dataMarket1.target)).to.be.equal(10);


            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 20)).not.to.be.reverted;
            expect(await proxyContract.batchSubmissionWindow(dataMarket1.target)).to.be.equal(20);

            await expect(proxyContract.updateAttestationSubmissionWindow(dataMarket1.target, 30)).not.to.be.reverted;
            expect(await proxyContract.attestationSubmissionWindow(dataMarket1.target)).to.be.equal(30);

            await expect(proxyContract.loadSlotSubmissions(dataMarket1.target, 1, 1, 20)).not.to.be.reverted;
            expect(await proxyContract.slotSubmissionCount(dataMarket1.target, 1, 1)).to.be.equal(20);

            await expect(proxyContract.loadCurrentDay(dataMarket1.target, 26)).not.to.be.reverted;
            expect(await proxyContract.dayCounter(dataMarket1.target)).to.be.equal(26);

        });
        
        it("Should get and set epoch related data from the data market contract", async function () {
            expect(await proxyContract.epochManager(dataMarket1.target)).to.be.equal(epochManager.address);
            expect(await proxyContract.getEpochManager(dataMarket1.target)).to.be.equal(epochManager.address);

            expect(await dataMarket1.getTotalSnapshotterCount()).to.be.equal(1);

            await expect(proxyContract.updateEpochManager(dataMarket1.target, otherAccount2.address))
                .to.not.be.reverted;
            expect(await proxyContract.epochManager(dataMarket1.target)).to.be.equal(otherAccount2.address);

            const EPOCH_SIZE = await proxyContract.EPOCH_SIZE(dataMarket1.target);
            expect(EPOCH_SIZE).to.be.equal(epochSize);
            expect(await proxyContract.SOURCE_CHAIN_ID(dataMarket1.target)).to.be.equal(137);
            const sourceChainBlockTime = await proxyContract.SOURCE_CHAIN_BLOCK_TIME(dataMarket1.target);
            expect(sourceChainBlockTime).to.be.equal(20000);
            expect(await proxyContract.USE_BLOCK_NUMBER_AS_EPOCH_ID(dataMarket1.target)).to.be.false;

            const currentEpoch = await proxyContract.currentEpoch(dataMarket1.target);
            expect(currentEpoch.epochId).to.be.equal(1);
            expect(currentEpoch.end).to.be.equal(epochSize);
            expect(currentEpoch.begin).to.be.equal(1);
            const nextEpochBlock = currentEpoch.end + 1n;

            let blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount2).releaseEpoch(dataMarket1.target, nextEpochBlock, nextEpochBlock + BigInt(epochSize - 1)))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket1.target, 2, nextEpochBlock, nextEpochBlock + BigInt(epochSize - 1), blockTimestamp + 1);
            const nextEpoch = await proxyContract.currentEpoch(dataMarket1.target);
            expect(nextEpoch.epochId).to.be.equal(2n);
            expect(nextEpoch.end).to.be.equal(nextEpochBlock + BigInt(epochSize - 1));
            expect(nextEpoch.begin).to.be.equal(nextEpochBlock);

            const skipEpochBlock = nextEpochBlock + BigInt(5 * epochSize);
            await expect(proxyContract.forceSkipEpoch(dataMarket1.target, skipEpochBlock, skipEpochBlock + BigInt(epochSize - 1)))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket1.target, 7, skipEpochBlock, skipEpochBlock + BigInt(epochSize - 1), blockTimestamp + 2);
            const skippedEpoch = await proxyContract.currentEpoch(dataMarket1.target);
            expect(skippedEpoch.epochId).to.be.equal(7n); // 2 + 5 skipped epochs
            expect(skippedEpoch.end).to.be.equal(skipEpochBlock + BigInt(epochSize - 1));
            expect(skippedEpoch.begin).to.be.equal(skipEpochBlock);

            let dayCounter = await proxyContract.dayCounter(dataMarket1.target);
            expect(dayCounter).to.be.equal(1);

            const day = BigInt(864000000);
            const expectedEpochsInADay = day / (sourceChainBlockTime * BigInt(epochSize));
            expect(await proxyContract.epochsInADay(dataMarket1.target)).to.be.equal(expectedEpochsInADay);

            const epochInfo = await proxyContract.epochInfo(dataMarket1.target, 7);
            expect(epochInfo.epochEnd).to.be.equal(skipEpochBlock + BigInt(epochSize - 1));

            // Should start a new day when the day's last epoch is released
            const epochsInADay = await proxyContract.epochsInADay(dataMarket1.target);

            // 1 epoch == 1 block for this data market
            const blocksToMine = (epochsInADay * BigInt(epochSize)) - epochInfo.epochEnd;
            await mine(blocksToMine);

            const startBlock = (epochsInADay - 1n) * BigInt(epochSize) + 1n;

            blockTimestamp = await time.latest();
            // force skip to the next day
            await expect(proxyContract.forceSkipEpoch(
                dataMarket1.target, 
                startBlock, 
                startBlock + BigInt(epochSize - 1))
            ).to.emit(proxyContract, "EpochReleased")
              .withArgs(
                dataMarket1.target, 
                epochsInADay, 
                startBlock,
                startBlock + BigInt(epochSize - 1),
                blockTimestamp + 1
            );
            
            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestampBefore = blockBefore.timestamp + 1;
            dayCounter += 1n;
            const expectedDayStart = BigInt(dayCounter);

            await expect(proxyContract.connect(otherAccount2).releaseEpoch(
                dataMarket1.target,
                epochsInADay * BigInt(epochSize) + 1n,
                epochsInADay * BigInt(epochSize) + BigInt(epochSize)
            ))
                .to.emit(proxyContract, "DayStartedEvent")
                    .withArgs(dataMarket1.target, expectedDayStart, timestampBefore)
                .to.emit(proxyContract, "EpochReleased")
                    .withArgs(dataMarket1.target, epochsInADay + 1n, epochsInADay * BigInt(epochSize) + 1n, epochsInADay * BigInt(epochSize) + BigInt(epochSize), timestampBefore)
                .to.emit(dataMarket1, "DayStartedEvent")
                    .withArgs(expectedDayStart, timestampBefore);

        });

        it("Should get and set epoch related data from the data market contract with blocknumber for epochId", async function () {
            expect(await proxyContract.updateEpochManager(dataMarket2.target, epochManager.address))
                .to.emit(proxyContract, "EpochManagerUpdated")
                .withArgs(dataMarket2.target, epochManager.address);

            let blockTimestamp = await time.latest();
            expect(await proxyContract.connect(epochManager).releaseEpoch(dataMarket2.target, 1, 1))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket2.target, 1, 1, 1, blockTimestamp + 1);


            expect(await proxyContract.epochManager(dataMarket2.target)).to.be.equal(epochManager.address);
            expect(await proxyContract.getEpochManager(dataMarket2.target)).to.be.equal(epochManager.address);

            await expect(proxyContract.updateEpochManager(dataMarket2.target, otherAccount2.address))
                .to.not.be.reverted;
            expect(await proxyContract.epochManager(dataMarket2.target)).to.be.equal(otherAccount2.address);

            const EPOCH_SIZE = await proxyContract.EPOCH_SIZE(dataMarket2.target);
            expect(EPOCH_SIZE).to.be.equal(1);
            expect(await proxyContract.SOURCE_CHAIN_ID(dataMarket2.target)).to.be.equal(137);
            const sourceChainBlockTime = await proxyContract.SOURCE_CHAIN_BLOCK_TIME(dataMarket2.target);
            expect(sourceChainBlockTime).to.be.equal(20000);
            expect(await proxyContract.USE_BLOCK_NUMBER_AS_EPOCH_ID(dataMarket2.target)).to.be.false;

            const currentEpoch = await proxyContract.currentEpoch(dataMarket2.target);
            expect(currentEpoch.epochId).to.be.equal(1);
            expect(currentEpoch.end).to.be.equal(1);
            expect(currentEpoch.begin).to.be.equal(1);
            const nextEpochBlock = currentEpoch.end + 1n;

            blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount2).releaseEpoch(dataMarket2.target, nextEpochBlock, nextEpochBlock))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket2.target, 2, nextEpochBlock, nextEpochBlock, blockTimestamp + 1);
            const nextEpoch = await proxyContract.currentEpoch(dataMarket2.target);
            expect(nextEpoch.epochId).to.be.equal(2n);
            expect(nextEpoch.end).to.be.equal(nextEpochBlock);
            expect(nextEpoch.begin).to.be.equal(nextEpochBlock);

            const skipEpochBlock = nextEpochBlock + BigInt(5 * epochSize);
            await expect(proxyContract.forceSkipEpoch(dataMarket2.target, skipEpochBlock, skipEpochBlock))
                .to.emit(proxyContract, "EpochReleased")
                .withArgs(dataMarket2.target, skipEpochBlock, skipEpochBlock, skipEpochBlock, blockTimestamp + 2);
            const skippedEpoch = await proxyContract.currentEpoch(dataMarket2.target);
            expect(skippedEpoch.epochId).to.be.equal(skipEpochBlock);
            expect(skippedEpoch.end).to.be.equal(skipEpochBlock);
            expect(skippedEpoch.begin).to.be.equal(skipEpochBlock);

            let dayCounter = await proxyContract.dayCounter(dataMarket2.target);
            expect(dayCounter).to.be.equal(1);

            const day = BigInt(864000000);
            const expectedEpochsInADay = day / sourceChainBlockTime;
            expect(await proxyContract.epochsInADay(dataMarket2.target)).to.be.equal(expectedEpochsInADay);

            const epochInfo = await proxyContract.epochInfo(dataMarket2.target, skipEpochBlock);
            expect(epochInfo.epochEnd).to.be.equal(skipEpochBlock);

            // Should start a new day when the day's last epoch is released
            const epochsInADay = await proxyContract.epochsInADay(dataMarket2.target);

            // 1 epoch == 1 block for this data market
            const blocksToMine = epochsInADay - epochInfo.epochEnd;
            await mine(blocksToMine);

            blockTimestamp = await time.latest();
            await expect(proxyContract.forceSkipEpoch(
                dataMarket2.target, 
                epochsInADay, 
                epochsInADay)
            ).to.emit(proxyContract, "EpochReleased")
              .withArgs(dataMarket2.target, epochsInADay, epochsInADay, epochsInADay, blockTimestamp + 1);
            
            const blockNumBefore = await ethers.provider.getBlockNumber();
            const blockBefore = await ethers.provider.getBlock(blockNumBefore);
            const timestampBefore = blockBefore.timestamp + 1;
            dayCounter += 1n;
            const expectedDayStart = BigInt(dayCounter);

            await expect(proxyContract.connect(otherAccount2).releaseEpoch(
                dataMarket2.target,
                epochsInADay + 1n,
                epochsInADay + 1n
            ))
                .to.emit(proxyContract, "DayStartedEvent")
                    .withArgs(dataMarket2.target, expectedDayStart, timestampBefore)
                .to.emit(proxyContract, "EpochReleased")
                    .withArgs(dataMarket2.target, epochsInADay + 1n, epochsInADay + 1n, epochsInADay + 1n, timestampBefore)
                .to.emit(dataMarket2, "DayStartedEvent")
                    .withArgs(expectedDayStart, timestampBefore);
        });

        it("Should get and set sequencer data from the data market contract", async function () {
            const testSequencerId = "test-sequencer-id";

            await expect(proxyContract.setSequencerId(dataMarket1.target, testSequencerId))
                .to.not.be.reverted;
            expect(await proxyContract.getSequencerId(dataMarket1.target)).to.equal(testSequencerId);

            const sequencers = await proxyContract.getSequencers(dataMarket1.target);
            expect(sequencers[0]).to.equal(otherAccount1.address);
            expect(await proxyContract.getTotalSequencersCount(dataMarket1.target)).to.be.equal(1);
        });

        it("Should get and set validator data from the data market contract", async function () {
            // set otherAccount1 as a validator
            const role = 0
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );
            const validators = await proxyContract.getValidators(dataMarket1.target);
            expect(validators[0]).to.equal(otherAccount1.address);
            expect(await proxyContract.getTotalValidatorsCount(dataMarket1.target)).to.be.equal(1);
        });

        it("Should get the reward related data from the data market contract", async function () {
            await expect(proxyContract.updateDailySnapshotQuota(dataMarket1.target, 5))
                .to.not.be.reverted;
            expect(await proxyContract.dailySnapshotQuota(dataMarket1.target)).to.equal(5);

            await expect(proxyContract.toggleRewards(dataMarket1.target))
                .to.not.be.reverted;
            expect(await proxyContract.rewardsEnabled(dataMarket1.target)).to.be.false;
            await expect(proxyContract.toggleRewards(dataMarket1.target))
                .to.not.be.reverted;
            expect(await proxyContract.rewardsEnabled(dataMarket1.target)).to.be.true;
        });

        it("Should successfully get and update slot related data", async function () {
            
            expect(await proxyContract.getTotalSnapshotterCount()).to.be.equal(slotCount);
            expect(await proxyContract.slotSnapshotterMapping(slotId)).to.equal(otherAccount1.address);

            const slotInfo = await proxyContract.getSlotInfo(dataMarket1.target, slotId);
            expect(slotInfo.snapshotterAddress).to.equal(otherAccount1.address);
            expect(slotInfo.slotId).to.equal(slotId);
            expect(slotInfo.currentDaySnapshotCount).to.be.equal(0);
            expect(slotInfo.rewardPoints).to.be.equal(0);

            const currentDay = await proxyContract.dayCounter(dataMarket1.target);
            const submissions = 1;
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [slotId], 
                [submissions], 
                currentDay,
                1
            )).to.not.be.reverted;
            expect(await proxyContract.slotSubmissionCount(dataMarket1.target, slotId, currentDay)).to.be.equal(submissions);

            expect(await proxyContract.checkSlotTaskStatusForDay(dataMarket1.target, slotId, currentDay)).to.be.equal(false);
            const dailySnapshotQuota = await proxyContract.dailySnapshotQuota(dataMarket1.target);

            const epochsInADay = await proxyContract.epochsInADay(dataMarket1.target);
            let currentEpoch = await proxyContract.currentEpoch(dataMarket1.target);

            const blocksToMine = (epochsInADay * BigInt(epochSize)) - currentEpoch.end;
            await mine(blocksToMine);

            let blockTimestamp = await time.latest();
            await expect(proxyContract.forceSkipEpoch(
                dataMarket1.target, 
                (epochsInADay - 1n) * BigInt(epochSize) + 1n, 
                epochsInADay * BigInt(epochSize))
            ).to.emit(proxyContract, "EpochReleased")
              .withArgs(dataMarket1.target, epochsInADay, (epochsInADay - 1n) * BigInt(epochSize) + 1n, epochsInADay * BigInt(epochSize), blockTimestamp + 1);

            await expect(proxyContract.connect(epochManager).releaseEpoch(
                dataMarket1.target,
                epochsInADay * BigInt(epochSize) + 1n,
                epochsInADay * BigInt(epochSize) + BigInt(epochSize)
            )).to.emit(proxyContract, "DayStartedEvent")
              .withArgs(dataMarket1.target, currentDay + 1n, blockTimestamp + 2)
              .to.emit(proxyContract, "EpochReleased")
              .withArgs(dataMarket1.target, epochsInADay + 1n, epochsInADay * BigInt(epochSize) + 1n, epochsInADay * BigInt(epochSize) + BigInt(epochSize), blockTimestamp + 2)
              .to.emit(dataMarket1, "DayStartedEvent")
              .withArgs(currentDay + 1n, blockTimestamp + 2);
            
            const rewardPoolSize = await dataMarket1.rewardPoolSize();
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [slotId], 
                [dailySnapshotQuota], 
                currentDay + 1n,
                1
            )).to.emit(proxyContract, "DailyTaskCompletedEvent")
              .withArgs(dataMarket1.target, otherAccount1.address, slotId, currentDay + 1n, blockTimestamp + 3);
            expect(await proxyContract.checkSlotTaskStatusForDay(dataMarket1.target, slotId, currentDay + 1n)).to.be.equal(true);

        });

        it("Should successfully get and update reward data", async function () {
            await expect(proxyContract.updateRewardPoolSize(dataMarket1.target, 100)).not.to.be.reverted;
            expect(await proxyContract.rewardPoolSize(dataMarket1.target)).to.be.equal(100);

            // set otherAccount1 as a sequencer
            const role = 1
            await proxyContract.updateAddresses(
                dataMarket1.target,
                role,
                [otherAccount1.address], 
                [true],
            );

            await dataMarket1.connect(otherAccount1).updateEligibleNodesForDay(1, 1);

            const rewardPoolSize = await dataMarket1.rewardPoolSize();
            const eligibleNodesForDay = await dataMarket1.eligibleNodesForDay(1);
            const expectedRewardPoints = rewardPoolSize / eligibleNodesForDay;

            const dailySnapshotQuota = await proxyContract.dailySnapshotQuota(dataMarket1.target);

            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(otherAccount1).updateRewards(
                dataMarket1.target, 
                [1], 
                [dailySnapshotQuota], 
                1,
                1
            )).to.emit(proxyContract, "RewardsDistributedEvent")
              .withArgs(dataMarket1.target, otherAccount1.address, 1, 1, expectedRewardPoints, blockTimestamp + 1);

            expect(await proxyContract.slotRewardPoints(dataMarket1.target, 1)).to.equal(expectedRewardPoints);
            expect(await proxyContract.slotSubmissionCount(dataMarket1.target, 1, 1)).to.equal(dailySnapshotQuota);

        });
    });

    describe("Access Control", function () {
        it("Should successfully limit access to onlyOwner modified functions", async function () {
            await expect(proxyContract.connect(otherAccount1).createDataMarket(
                otherAccount1.address,
                10,
                1,
                120000,
                false
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");

            await expect(proxyContract.connect(otherAccount1).updateDataMarketFactory(
                otherAccount2.address
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");

            await expect(proxyContract.connect(otherAccount1).updateSnapshotterState(
                otherAccount2.address
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");

            await expect(proxyContract.connect(otherAccount1).toggleDataMarket(
                dataMarket1.target,
                false
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");

            await expect(proxyContract.connect(otherAccount1).updateDataMarketFactory(
                otherAccount2.address
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");

            await expect(proxyContract.connect(otherAccount1).emergencyWithdraw(
            )).to.be.revertedWithCustomError(proxyContract, "OwnableUnauthorizedAccount");
        });
        
        it("Should successfully limit access to the DataMarket onlySequencer and onlyValidator functions", async function () {
            // Try to submit a batch as a non-sequencer
            const batchCid = "test-batch-cid";
            const epochId = 1;
            const projectIds = ["test-project-1"];
            const snapshotCids = ["test-snapshot-1"];
            const finalizedCidsRootHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

            await expect(proxyContract.updateBatchSubmissionWindow(dataMarket1.target, 10)).to.not.be.reverted;

            await expect(proxyContract.connect(otherAccount2).submitSubmissionBatch(
                dataMarket1.target,
                batchCid,
                epochId,
                projectIds,
                snapshotCids,
                finalizedCidsRootHash
            )).to.be.revertedWith("E04");
            expect(errorCodes["E04"]).to.equal("onlySequencer");

            const slotId = 1;
            const submissions = 5;
            const day = 1;
            
            await expect(dataMarket1.connect(otherAccount2).updateRewards(
                slotId,
                submissions,
                day
            )).to.be.revertedWith("E04");

            await expect(proxyContract.connect(otherAccount2).updateRewards(
                dataMarket1.target,
                [slotId],
                [submissions],
                day,
                1
            )).to.be.revertedWith("E04");

            await expect(dataMarket1.connect(otherAccount2).endBatchSubmissions(
                epochId
            )).to.be.revertedWith("E04");

            await expect(proxyContract.connect(otherAccount2).endBatchSubmissions(
                dataMarket1.target,
                epochId
            )).to.be.revertedWith("E04");

            await expect(proxyContract.connect(otherAccount2).submitBatchAttestation(
                dataMarket1.target,
                batchCid,
                epochId,
                finalizedCidsRootHash
            )).to.be.revertedWith("E01");
            expect(errorCodes["E01"]).to.equal("onlyValidator");
        });

        it("Should successfully limit access to the DataMarket onlyOwnerOrigin modified functions", async function () {
            // Test data setup
            const batchCid = "test-batch-cid";
            const epochId = 1;
            const newWindow = 10;
            const newQuota = 100;
            const newRewardPoolSize = ethers.parseEther("2000");
            const newEpochManager = otherAccount2.address;
    
            await expect(dataMarket1.connect(otherAccount1).forceCompleteConsensusAttestations(
                batchCid,
                epochId
            )).to.be.revertedWith("E03");
            expect(errorCodes["E03"]).to.equal("onlyOwner");
    
            await expect(proxyContract.connect(otherAccount1).forceCompleteConsensusAttestations(
                dataMarket1.target,
                batchCid,
                epochId
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateSnapshotSubmissionWindow(
                newWindow
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateBatchSubmissionWindow(
                newWindow
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateAttestationSubmissionWindow(
                newWindow
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateMinAttestationsForConsensus(
                newWindow
            )).to.be.revertedWith("E03");

            await expect(dataMarket1.connect(otherAccount1).updateDailySnapshotQuota(
                newQuota
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateRewardPoolSize(
                newRewardPoolSize
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateEpochManager(
                newEpochManager
            )).to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).toggleRewards())
                .to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).updateDaySize(100))
                .to.be.revertedWith("E03");
    
            await expect(dataMarket1.connect(otherAccount1).setSequencerId("test-id"))
                .to.be.revertedWith("E08");

            await expect(dataMarket1.connect(otherAccount1).forceSkipEpoch(1, 100))
                .to.be.revertedWith("E03");

            await expect(dataMarket1.connect(otherAccount1).loadSlotSubmissions(1, 1, 20))
                .to.be.revertedWith("E03");

            await expect(dataMarket1.connect(otherAccount1).loadCurrentDay(26))
                .to.be.revertedWith("E03");

            await expect(dataMarket1.connect(otherAccount1).updateProtocolState("0x0000000000000000000000000000000000000000"))
                .to.be.revertedWith("E03");

            await expect(dataMarket1.connect(otherAccount1).updateAddresses(1, [otherAccount1.address], [true]))
                .to.be.revertedWith("E03");
        });

        it("Should successfully limit access to the DataMarket isActive modified functions", async function () {
            // disable the data market
            await expect(proxyContract.toggleDataMarket(dataMarket1.target, false))
                .to.not.be.reverted;
            expect(await proxyContract.dataMarketEnabled(dataMarket1.target)).to.be.false;

            // Try to release epoch when data market is disabled
            await expect(proxyContract.connect(epochManager).releaseEpoch(
                dataMarket1.target,
                1,
                1
            )).to.be.revertedWith("E02");
            expect(errorCodes["E02"]).to.equal("notActive");

            await expect(proxyContract.forceSkipEpoch(
                dataMarket1.target,
                1,
                1
            )).to.be.revertedWith("E02");

            // Re-enable the data market
            await expect(proxyContract.toggleDataMarket(dataMarket1.target, true))
                .to.not.be.reverted;
            expect(await proxyContract.dataMarketEnabled(dataMarket1.target)).to.be.true;

            // Verify functions work when data market is enabled
            const blockTimestamp = await time.latest();
            await expect(proxyContract.connect(epochManager).releaseEpoch(
                dataMarket1.target,
                1,
                10
            )).to.emit(proxyContract, "EpochReleased")
              .withArgs(dataMarket1.target, 1, 1, 10, blockTimestamp + 1);

            await expect(proxyContract.forceSkipEpoch(
                dataMarket1.target,
                11,
                20
            )).to.emit(proxyContract, "EpochReleased")
              .withArgs(dataMarket1.target, 2, 11, 20, blockTimestamp + 2);
        });
    });

    describe("Emergency Withdraw", function () {
        it("Should successfully emergency withdraw rewards", async function () {

            // send rewards for distribution
            await owner.sendTransaction({
                to: proxyContract.target,
                value: ethers.parseEther("100")
            });

            const contractBalanceBefore = await ethers.provider.getBalance(proxyContract.target);
            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
            await expect(proxyContract.connect(owner).emergencyWithdraw()).to.not.be.reverted;
            const contractBalanceAfter = await ethers.provider.getBalance(proxyContract.target);
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            expect(contractBalanceAfter).to.be.equal(contractBalanceBefore - ethers.parseEther("100"));
            expect(ownerBalanceAfter).to.be.greaterThan(ownerBalanceBefore);

        });
    });
});

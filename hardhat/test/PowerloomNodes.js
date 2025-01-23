const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PowerloomNodes", function () {
    // Define accounts
    let owner, admin, user1, user2, user3;

    // Define contract instances
    let powerloomNodes, protocolState;

    // Define constants
    const NODE_PRICE = ethers.parseEther("1");
    const NAME = "Powerloom Nodes Test";

    // Fixture to deploy contracts
    async function deployContractsFixture() {
        [owner, admin, user1, user2, user3] = await ethers.getSigners();

        // Deploy ProtocolState contract (mock or actual implementation)
        const ProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
        protocolState = await upgrades.deployProxy(ProtocolState, [owner.address]);
        await protocolState.waitForDeployment();

        // Deploy PowerloomNodes contract
        const PowerloomNodes = await ethers.getContractFactory("PowerloomNodes");
        powerloomNodes = await upgrades.deployProxy(PowerloomNodes, [
            owner.address,
            NODE_PRICE,
            NAME
        ]);
        await powerloomNodes.waitForDeployment();

        // Deploy DataMarket contract if necessary
        const DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
        const dataMarketFactory = await DataMarketFactory.deploy();
        await dataMarketFactory.waitForDeployment();

        await protocolState.updateDataMarketFactory(await dataMarketFactory.getAddress());

        const dataMarketTx = await protocolState.createDataMarket(owner.address, 1, 31337, 20000, false);
        const receipt = await dataMarketTx.wait();
        expect(receipt.status).to.equal(1);

        const filter = dataMarketFactory.filters.DataMarketCreated();
        let logs = await dataMarketFactory.queryFilter(filter, 0, "latest");
        let dataMarketAddress;

        // Parse and display the logs
        logs.forEach((log) => {
            const parsedLog = dataMarketFactory.interface.parseLog(log);
            dataMarketAddress = parsedLog.args.dataMarketAddress;
        });

        const DataMarket = await ethers.getContractFactory("PowerloomDataMarket");
        const dataMarket = DataMarket.attach(dataMarketAddress);

        return { powerloomNodes, protocolState, owner, admin, user1, user2, user3, dataMarket };
    }

    // Fixture to mint a node
    async function mintNodeFixture() {
        const { powerloomNodes, user1 } = await loadFixture(deployContractsFixture);
        const mintAmount = 1;
        const nodeId = 1;
        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await powerloomNodes.setMintStartTime(blockTimestamp - 100);
        await powerloomNodes.connect(user1).mintNode(mintAmount, { value: NODE_PRICE });

        return { powerloomNodes, user1, mintAmount, nodeId };
    }

  describe("Initialization", function () {
    it("Should set the right owner", async function () {
        const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
        expect(await powerloomNodes.owner()).to.equal(owner.address);
    });

    it("Should initialize with correct values", async function () {
        const { powerloomNodes } = await loadFixture(deployContractsFixture);
        expect(await powerloomNodes.nodePrice()).to.equal(NODE_PRICE);
        expect(await powerloomNodes.name()).to.equal(NAME);
    });

    it("Should allow owner to update admins", async function () {
        const { powerloomNodes, owner, admin, user1 } = await loadFixture(deployContractsFixture);
        // Add admin
        await expect(powerloomNodes.connect(owner).updateAdmins([admin.address], [true]))
            .to.emit(powerloomNodes, "AdminsUpdated")
            .withArgs(admin.address, true);

        // Check if admin is in the admins list
        expect(await powerloomNodes.getAdmins()).to.include(admin.address);

        // Remove admin
        await expect(powerloomNodes.connect(owner).updateAdmins([admin.address], [false]))
            .to.emit(powerloomNodes, "AdminsUpdated")
            .withArgs(admin.address, false);

        // Check if admin is not in the admins list
        expect(await powerloomNodes.getAdmins()).to.not.include(admin.address);

        // non-owner should not be able to update admins
        await expect(powerloomNodes.connect(user1).updateAdmins([admin.address], [true]))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");

        // should revert if admins array lengths don't match
        await expect(powerloomNodes.connect(owner).updateAdmins([admin.address, user1.address], [true]))
            .to.be.revertedWith("Input lengths do not match");
    });

    it("Should allow the owner to update the URI", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const newURI = "https://newuri.com/{id}.json";
        await expect(powerloomNodes.connect(owner).setURI(newURI))
            .to.emit(powerloomNodes, "URIUpdated")
            .withArgs(newURI);

        // non-owner should not be able to update the URI
        await expect(powerloomNodes.connect(user1).setURI(newURI))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
    });

    it("Should allow the owner to set mint start time", async function () {
        const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await expect(powerloomNodes.connect(owner).setMintStartTime(blockTimestamp - 100))
            .to.emit(powerloomNodes, "ConfigurationUpdated")
            .withArgs("MintStartTime", blockTimestamp - 100);

        // non-owner should not be able to set mint start time
        await expect(powerloomNodes.connect(user1).setMintStartTime(blockTimestamp - 100))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");

        expect(await powerloomNodes.mintStartTime()).to.equal(blockTimestamp - 100);
    });

    it("Should allow the owner to set snapshotter address change cooldown", async function () {
        const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
        const cooldown = 100;
        await expect(powerloomNodes.connect(owner).setSnapshotterAddressChangeCooldown(cooldown))
            .to.emit(powerloomNodes, "ConfigurationUpdated")
            .withArgs("SnapshotterAddressChangeCooldown", cooldown);

        // non-owner should not be able to set snapshotter address change cooldown
        await expect(powerloomNodes.connect(user1).setSnapshotterAddressChangeCooldown(cooldown))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");

        expect(await powerloomNodes.snapshotterAddressChangeCooldown()).to.equal(cooldown);
    });

    it("Should allow the owner to pause and unpause the contract", async function () {
        const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
        await expect(powerloomNodes.connect(owner).pause()).to.emit(powerloomNodes, "Paused");
        await expect(powerloomNodes.connect(owner).unpause()).to.emit(powerloomNodes, "Unpaused");

        // non-owner should not be able to pause the contract
        await expect(powerloomNodes.connect(user1).pause())
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");

        // non-owner should not be able to unpause the contract
        await expect(powerloomNodes.connect(user1).unpause())
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
    });

    it("Should allow the owner to update the node price", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const newNodePrice = ethers.parseEther("2");
        await expect(powerloomNodes.connect(owner).updateNodePrice(newNodePrice))
            .to.emit(powerloomNodes, "ConfigurationUpdated")
            .withArgs("NodePrice", newNodePrice);

        expect(await powerloomNodes.nodePrice()).to.equal(newNodePrice);

        // non-owner should not be able to update the node price
        await expect(powerloomNodes.connect(user1).updateNodePrice(newNodePrice))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
    });

    it("Should allow the owner to update the snapshotter token claim cooldown", async function () {
        const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
        const cooldown = 100;
        await expect(powerloomNodes.connect(owner).setSnapshotterTokenClaimCooldown(cooldown))
            .to.emit(powerloomNodes, "ConfigurationUpdated")
            .withArgs("SnapshotterTokenClaimCooldown", cooldown);

        expect(await powerloomNodes.snapshotterTokenClaimCooldown()).to.equal(cooldown);

        // non-owner should not be able to update the snapshotter token claim cooldown
        await expect(powerloomNodes.connect(user1).setSnapshotterTokenClaimCooldown(cooldown))
            .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
    });

  });

  describe("Transfer", function () {
    it("Should not allow safe transfers from or safe batch transfers", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const nodeId = 1;
        await powerloomNodes.setMintStartTime(Math.floor(Date.now() / 1000) - 100);
        await powerloomNodes.connect(owner).mintNode(1, { value: NODE_PRICE });

        await expect(powerloomNodes.connect(owner).safeTransferFrom(owner.address, user1.address, nodeId, 1, "0x"))
            .to.be.revertedWith("Transfers are not allowed on SBTs");

        await expect(powerloomNodes.connect(owner).safeBatchTransferFrom(owner.address, user1.address, [nodeId], [1], "0x"))
            .to.be.revertedWith("Transfers are not allowed on SBTs");
    });
  });

  describe("Node Minting", function () {
    it("Should allow a user to create a node with sufficient power", async function () {
        const { powerloomNodes, user1 } = await loadFixture(deployContractsFixture);
        const mintAmount = 1;

        await powerloomNodes.setMintStartTime(Math.floor(Date.now() / 1000) - 100);

        await expect(powerloomNodes.connect(user1).mintNode(mintAmount, { value: NODE_PRICE }))
            .to.emit(powerloomNodes, "NodeMinted")
            .withArgs(user1.address, mintAmount);

        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        const nodeInfo = await powerloomNodes.nodeInfo(mintAmount);

        // Check node info
        expect(nodeInfo.snapshotterAddress).to.equal('0x0000000000000000000000000000000000000000');
        expect(nodeInfo.nodePrice).to.equal(NODE_PRICE);
        expect(nodeInfo.amountSentOnL1).to.equal(0);
        expect(nodeInfo.mintedOn).to.be.equal(blockTimestamp);
        expect(nodeInfo.burnedOn).to.equal(0);
        expect(nodeInfo.lastUpdated).to.be.equal(blockTimestamp);
        expect(nodeInfo.isLegacy).to.be.false;
        expect(nodeInfo.claimedTokens).to.be.false;
        expect(nodeInfo.active).to.be.false;
        expect(nodeInfo.isKyced).to.be.false;

        // Check contract state
        const nodeCounter = await powerloomNodes.nodeCount();
        expect(nodeCounter).to.equal(1);

        const nodeIdToOwner = await powerloomNodes.nodeIdToOwner(1);
        expect(nodeIdToOwner).to.equal(user1.address);
    });

    it("Should return excess ETH if more than enough power is sent on mint", async function () {
        const { powerloomNodes, user1 } = await loadFixture(deployContractsFixture);
        const mintAmount = 1n;
        const nodePrice = await powerloomNodes.nodePrice();
        const excessPower = nodePrice * mintAmount + ethers.parseEther("100");

        const balanceBefore = await ethers.provider.getBalance(user1.address);

        await powerloomNodes.setMintStartTime(Math.floor(Date.now() / 1000) - 100);

        await expect(powerloomNodes.connect(user1).mintNode(mintAmount, { value: excessPower }))
            .to.emit(powerloomNodes, "NodeMinted")
            .withArgs(user1.address, mintAmount);

        const balanceAfter = await ethers.provider.getBalance(user1.address);

        // Check if the excess power is returned with a small margin of error for gas fees
        expect(balanceAfter).to.be.closeTo(balanceBefore - (nodePrice * mintAmount), ethers.parseEther("0.01"));
    });

    it("Should not allow creating a node with insufficient power", async function () {
        const { powerloomNodes, user1 } = await loadFixture(deployContractsFixture);
        const insufficientPower = ethers.parseEther("0.5");

        // Also test the other initial checks in the function
        await expect(powerloomNodes.connect(user1).mintNode(1, { value: insufficientPower }))
            .to.be.revertedWith("Mint start time is not set");

        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await powerloomNodes.setMintStartTime(blockTimestamp + 100);

        await expect(powerloomNodes.connect(user1).mintNode(1, { value: insufficientPower }))
            .to.be.revertedWith("Mint is not open yet");

        // Should fail to mint if amount is 0
        await expect(powerloomNodes.connect(user1).mintNode(0, { value: NODE_PRICE }))
            .to.be.revertedWith("Amount must be greater than 0");

        // Test insufficient power
        await powerloomNodes.setMintStartTime(Math.floor(Date.now() / 1000) - 100);
        await expect(powerloomNodes.connect(user1).mintNode(1, { value: insufficientPower }))
            .to.be.revertedWith("Not enough Power!");
    });

    it("Should allow node owner to burn their node and update node info correctly", async function () {
        const { powerloomNodes, user1 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        // Get initial node info
        const initialNodeInfo = await powerloomNodes.nodeInfo(nodeId);

        await expect(powerloomNodes.connect(user1).burnNode(nodeId))
            .to.emit(powerloomNodes, "NodeBurned")
            .withArgs(user1.address, nodeId);

        const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
        const nodeInfo = await powerloomNodes.nodeInfo(nodeId);
        
        // Check all attributes of NodeInfo
        expect(nodeInfo.snapshotterAddress).to.equal(ethers.ZeroAddress);
        expect(nodeInfo.nodePrice).to.equal(initialNodeInfo.nodePrice);
        expect(nodeInfo.amountSentOnL1).to.equal(initialNodeInfo.amountSentOnL1);
        expect(nodeInfo.mintedOn).to.equal(initialNodeInfo.mintedOn);
        expect(nodeInfo.burnedOn).to.equal(blockTimestamp);
        expect(nodeInfo.lastUpdated).to.equal(blockTimestamp);
        expect(nodeInfo.isLegacy).to.equal(initialNodeInfo.isLegacy);
        expect(nodeInfo.claimedTokens).to.equal(initialNodeInfo.claimedTokens);
        expect(nodeInfo.active).to.be.false;
        expect(nodeInfo.isKyced).to.equal(initialNodeInfo.isKyced);

        // Check if the node is marked as burned
        expect(await powerloomNodes.isNodeBurned(nodeId)).to.be.true;

        // Check if the node is removed from the user's token list
        const userOwnedNodeIds = await powerloomNodes.getUserOwnedNodeIds(user1.address);
        expect(userOwnedNodeIds).to.not.include(nodeId);
    });

    it("Should restrict the burning of a node under certain conditions", async function () {
        const { powerloomNodes, user1, user2 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        await expect(powerloomNodes.connect(user2).burnNode(nodeId))
            .to.be.revertedWith("Only the owner can burn their own node");

        await expect(powerloomNodes.connect(user1).burnNode(nodeId + 1))
            .to.be.revertedWith("Node ID is out of bounds");
    });

    it("Should not allow burning a node when the contract is paused", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        await powerloomNodes.connect(owner).pause();

        await expect(powerloomNodes.connect(user1).burnNode(nodeId))
            .to.be.revertedWithCustomError(powerloomNodes, "EnforcedPause");

        await expect(powerloomNodes.connect(owner).mintNode(1, { value: NODE_PRICE }))
            .to.be.revertedWithCustomError(powerloomNodes, "EnforcedPause");
    });

    it("Should update the node active status when an assigned node is burned", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        // Assign a snapshotter to the node
        await powerloomNodes.connect(user1).assignSnapshotterToNode(nodeId, user1.address);

        const enabledCountBefore = await powerloomNodes.getTotalSnapshotterCount();

        // Check if the node is active
        const nodeInfo = await powerloomNodes.nodeInfo(nodeId);
        expect(nodeInfo.active).to.be.true;

        // Burn the node
        await powerloomNodes.connect(owner).deposit({ value: NODE_PRICE });
        await powerloomNodes.connect(user1).burnNode(nodeId);

        // Check if the node is no longer active
        const updatedNodeInfo = await powerloomNodes.nodeInfo(nodeId);
        expect(updatedNodeInfo.active).to.be.false;

        const enabledCountAfter = await powerloomNodes.getTotalSnapshotterCount();
        expect(enabledCountAfter).to.equal(enabledCountBefore - BigInt(1));
    });

  });

  describe("Snapshotter Assignment", function () {
    it("Should allow an owner to assign a snapshotter to a node", async function () {
        const { powerloomNodes, owner, user1, user2 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        // First assignment
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNode(nodeId, user2.address))
            .to.emit(powerloomNodes, "allSnapshottersUpdated")
            .withArgs(user2.address, true);

        // Check nodeInfo updates
        const nodeInfo = await powerloomNodes.nodeInfo(nodeId);
        expect(nodeInfo.snapshotterAddress).to.equal(user2.address);
        expect(nodeInfo.active).to.be.true;

        // Check contract state updates
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(1);
        expect(await powerloomNodes.allSnapshotters(user2.address)).to.be.true;

        // Set a cooldown period
        await powerloomNodes.connect(owner).setSnapshotterAddressChangeCooldown(3600); // 1 hour

        // Try to reassign immediately (should fail due to cooldown)
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNode(nodeId, owner.address))
            .to.be.revertedWith("Snapshotter address change cooldown not yet met");

        // Advance time past the cooldown period
        await time.increase(3601);

        // Reassign to a new address
        const user3 = ethers.Wallet.createRandom();
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNode(nodeId, user3.address))
            .to.emit(powerloomNodes, "allSnapshottersUpdated")
            .withArgs(user2.address, false)
            .to.emit(powerloomNodes, "allSnapshottersUpdated")
            .withArgs(user3.address, true);

        // Check nodeInfo updates after reassignment
        const updatedNodeInfo = await powerloomNodes.nodeInfo(nodeId);
        expect(updatedNodeInfo.snapshotterAddress).to.equal(user3.address);
        expect(updatedNodeInfo.active).to.be.true;

        // Check contract state updates after reassignment
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(1);
        expect(await powerloomNodes.allSnapshotters(user2.address)).to.be.false;
        expect(await powerloomNodes.allSnapshotters(user3.address)).to.be.true;

        // Try to assign from a non-owner address (should fail)
        await expect(powerloomNodes.connect(user2).assignSnapshotterToNode(nodeId, owner.address))
            .to.be.revertedWith("Only the owner can assign a snapshotter");
    });

    it("Should allow bulk assignment of snapshotters to nodes by owner", async function () {
        const { powerloomNodes, owner, user1, user2, user3 } = await loadFixture(deployContractsFixture);

        // Mint multiple nodes
        await powerloomNodes.connect(owner).setMintStartTime(Math.floor(Date.now() / 1000) - 100);
        await powerloomNodes.connect(owner).mintNode(3, { value: NODE_PRICE * 3n });
        const nodeId1 = 1;
        const nodeId2 = 2;
        const nodeId3 = 3;

        // Test successful bulk assignment
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1, nodeId2, nodeId3],
            [user1.address, user2.address, user3.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user1.address, true)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user2.address, true)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user3.address, true);

        // Verify assignments
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user1.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId2)).to.equal(user2.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId3)).to.equal(user3.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // Test reassignment
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1],
            [user2.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user1.address, false);

        // Verify reassignments
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user2.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId2)).to.equal(user2.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // non-owner trying to assign
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNodeBulk(
            [nodeId1], [user1.address]
        )).to.be.revertedWith("Only the owner can assign a snapshotter");

        // mismatched input lengths
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1, nodeId2], [user1.address]
        )).to.be.revertedWith("Input lengths do not match");

        // Test assigning the same snapshotter to multiple nodes
        // Should remove user2 and user3 from allSnapshotters
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1, nodeId2, nodeId3],
            [user1.address, user1.address, user1.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user1.address, true)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user2.address, false)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user3.address, false);

        // Verify assignments
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user1.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId2)).to.equal(user1.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId3)).to.equal(user1.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // Should remove user2 and user3 from allSnapshotters
        expect(await powerloomNodes.allSnapshotters(user2.address)).to.be.false;
        expect(await powerloomNodes.allSnapshotters(user3.address)).to.be.false;

        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // Test cooldown period
        await powerloomNodes.connect(owner).setSnapshotterAddressChangeCooldown(3600); // 1 hour cooldown

        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1],
            [user1.address]
        )).to.be.revertedWith("Snapshotter address change cooldown not yet met");

        // Advance time past the cooldown period
        await time.increase(3601);

        // Now the assignment should succeed
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeBulk(
            [nodeId1],
            [user2.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user2.address, true);

        // Verify final assignment
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user2.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);
    });

    it("Should allow an admin to assign snapshotters to nodes individually and in bulk", async function () {
        const { powerloomNodes, owner, admin, user1, user2, user3 } = await loadFixture(deployContractsFixture);
        
        // Mint multiple nodes
        await powerloomNodes.connect(owner).setMintStartTime(Math.floor(Date.now() / 1000) - 100);
        await powerloomNodes.connect(owner).mintNode(3, { value: NODE_PRICE * 3n });
        const nodeId1 = 1;
        const nodeId2 = 2;
        const nodeId3 = 3;

        // Set admin
        await powerloomNodes.connect(owner).updateAdmins([admin.address], [true]);

        // Test individual assignment
        await expect(powerloomNodes.connect(admin).assignSnapshotterToNodeAdmin(nodeId1, user1.address))
            .to.emit(powerloomNodes, "allSnapshottersUpdated")
            .withArgs(user1.address, true);

        // non-admin trying to assign
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNodeAdmin(nodeId1, user1.address))
            .to.be.revertedWith("Only owner or admin can call this function!");

        // Verify individual assignment
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user1.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(1);

        // Test bulk assignment
        await expect(powerloomNodes.connect(admin).assignSnapshotterToNodeBulkAdmin(
            [nodeId2, nodeId3],
            [user2.address, user3.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user2.address, true)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user3.address, true);

        // Verify bulk assignment
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId2)).to.equal(user2.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId3)).to.equal(user3.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // Test reassignment
        await expect(powerloomNodes.connect(admin).assignSnapshotterToNodeBulkAdmin(
            [nodeId2, nodeId3],
            [user1.address, user1.address]
        )).to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user2.address, false)
          .and.to.emit(powerloomNodes, "allSnapshottersUpdated").withArgs(user3.address, false);

        // Verify reassignment
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId1)).to.equal(user1.address);
        expect(await powerloomNodes.nodeSnapshotterMapping(nodeId2)).to.equal(user1.address);
        expect(await powerloomNodes.getTotalSnapshotterCount()).to.equal(3);

        // non-admin trying to assign
        await expect(powerloomNodes.connect(user1).assignSnapshotterToNodeBulkAdmin(
            [nodeId1], [user1.address]
        )).to.be.revertedWith("Only owner or admin can call this function!");

        // mismatched input lengths
        await expect(powerloomNodes.connect(admin).assignSnapshotterToNodeBulkAdmin(
            [nodeId1, nodeId2], [user1.address]
        )).to.be.revertedWith("Input lengths do not match");

        // invalid node ID
        await expect(powerloomNodes.connect(admin).assignSnapshotterToNodeBulkAdmin(
            [999], [user1.address]
        )).to.be.revertedWith("Node ID is out of bounds");

        // owner should be able to assign
        await expect(powerloomNodes.connect(owner).assignSnapshotterToNodeAdmin(nodeId1, user2.address))
            .to.emit(powerloomNodes, "allSnapshottersUpdated")
            .withArgs(user2.address, true);
    });

    it("Should return if a node is available or not", async function () {
        const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
        const { nodeId } = await loadFixture(mintNodeFixture);

        // node should be available
        expect(await powerloomNodes.isNodeAvailable(nodeId)).to.be.true;

        // node ids greater than max should not be available
        expect(await powerloomNodes.isNodeAvailable(nodeId + 1)).to.be.false;

        // node should not be available if burned
        await powerloomNodes.connect(user1).burnNode(nodeId);
        expect(await powerloomNodes.isNodeAvailable(nodeId)).to.be.false;
    });
});

    describe("Legacy Node Management", function () {
        it("Should allow the owner to update the name", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            const newName = "New Name";
            await expect(powerloomNodes.connect(owner).setName(newName))
                .to.emit(powerloomNodes, "NameUpdated")
                .withArgs(newName);
            expect(await powerloomNodes.name()).to.equal(newName);

            // non-owner should not be able to update the name
            await expect(powerloomNodes.connect(user1).setName(newName))
                .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
        });

        it("Should allow the owner to configure legacy nodes", async function () {
            const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
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

            await expect(powerloomNodes.connect(owner).configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.emit(powerloomNodes, "ConfigurationUpdated")
              .withArgs("LegacyNodesConfig", legacyConfig.legacyNodeCount);

            // non-owner should not be able to configure legacy nodes
            await expect(powerloomNodes.connect(user1).configureLegacyNodes(
                legacyConfig.legacyNodeCount,
                legacyConfig.legacyNodeInitialClaimPercentage,
                legacyConfig.legacyNodeCliff,
                legacyConfig.legacyNodeValue,
                legacyConfig.legacyNodeVestingDays,
                legacyConfig.legacyNodeVestingStart,
                legacyConfig.legacyTokensSentOnL1,
                legacyConfig.legacyNodeNonKycedCooldown
            )).to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");

            // Check all state changes
            expect(await powerloomNodes.legacyNodeCount()).to.equal(legacyConfig.legacyNodeCount);
            expect(await powerloomNodes.legacyNodeInitialClaimPercentage()).to.equal(legacyConfig.legacyNodeInitialClaimPercentage);
            expect(await powerloomNodes.legacyNodeCliff()).to.equal(legacyConfig.legacyNodeCliff);
            expect(await powerloomNodes.legacyNodeValue()).to.equal(legacyConfig.legacyNodeValue);
            expect(await powerloomNodes.legacyNodeVestingDays()).to.equal(legacyConfig.legacyNodeVestingDays);
            expect(await powerloomNodes.legacyNodeVestingStart()).to.equal(legacyConfig.legacyNodeVestingStart);
            expect(await powerloomNodes.legacyTokensSentOnL1()).to.equal(legacyConfig.legacyTokensSentOnL1);
            expect(await powerloomNodes.legacyNodeNonKycedCooldown()).to.equal(legacyConfig.legacyNodeNonKycedCooldown);
        });

        it("Should revert if initial claim percentage is too high", async function () {
            const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
            await expect(powerloomNodes.connect(owner).configureLegacyNodes(
                100, 1000001, 30, ethers.parseEther("1000"), 365, 
                (await time.latest()) + 86400, ethers.parseEther("100"), 7 * 86400
            )).to.be.revertedWith("Initial claim percentage must be less than 100%");
        });

        it("Should revert if tokens sent on L1 is greater than or equal to node value", async function () {
            const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
            await expect(powerloomNodes.connect(owner).configureLegacyNodes(
                100, 200000, 30, ethers.parseEther("1000"), 365, 
                (await time.latest()) + 86400, ethers.parseEther("1000"), 7 * 86400
            )).to.be.revertedWith("Tokens sent on L1 must be less than the total node value");
        });

        it("Should revert if legacy node value is zero", async function () {
            const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
            await expect(powerloomNodes.connect(owner).configureLegacyNodes(
                100, 200000, 30, 0, 365, 86400, 0, 86400
            )).to.be.revertedWith("Legacy node value must be greater than 0");
        });

        it("Should allow admin to mint legacy nodes", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            
            // Configure legacy nodes first
            const sentOnL1 = ethers.parseEther("1");
            const nodeValue = ethers.parseEther("10");
            await powerloomNodes.connect(owner).configureLegacyNodes(
                100, 200000, 30, nodeValue, 365, 
                (await time.latest()) + 86400, sentOnL1, 7 * 86400
            );

            const amount = 5;
            const isKyced = true;

            await expect(powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, amount, isKyced))
                .to.emit(powerloomNodes, "NodeMinted")
                .withArgs(user1.address, 1) // First node ID
                .to.emit(powerloomNodes, "NodeMinted")
                .withArgs(user1.address, amount); // Last node ID

            expect(await powerloomNodes.getNodesOwned(user1.address)).to.equal(amount);

            // Check node info for the first minted node
            const nodeInfo = await powerloomNodes.nodeInfo(1);
            expect(nodeInfo.snapshotterAddress).to.equal('0x0000000000000000000000000000000000000000');
            expect(nodeInfo.nodePrice).to.equal(nodeValue);
            expect(nodeInfo.amountSentOnL1).to.equal(sentOnL1);
            expect(nodeInfo.isLegacy).to.be.true;
            expect(nodeInfo.isKyced).to.equal(isKyced);

            // Should fail to mint if amount is 0
            await expect(powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, 0, isKyced))
                .to.be.revertedWith("Amount must be greater than 0");

            // non-owner should not be able to mint legacy nodes
            await expect(powerloomNodes.connect(user1).adminMintLegacyNodes(user1.address, 1, isKyced))
                .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
        });

        it("Should fail to mint a legacy node if legacy nodes are not configured", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            await expect(powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, 1, true))
                .to.be.revertedWith("Legacy nodes are not configured yet!");
        });

        it("Should calculate vested legacy node tokens correctly", async function () {
            const { powerloomNodes, owner } = await loadFixture(deployContractsFixture);
            
            const vestingStart = (await time.latest()) + 86400; // 1 day from now
            const nodeValue = ethers.parseEther("10");
            const sentOnL1 = ethers.parseEther("0");
            const initialClaimPercentage = 200000;
            const vestingDays = 365;
            const cliff = 30;
            const nonKycedCooldown = 7 * 86400;

            await powerloomNodes.connect(owner).configureLegacyNodes(
                100, initialClaimPercentage, cliff, nodeValue, vestingDays, 
                vestingStart, sentOnL1, nonKycedCooldown
            );

            // Before vesting starts
            expect(await powerloomNodes.vestedLegacyNodeTokens()).to.equal(0);

            // After vesting starts but before cliff
            await time.increaseTo(vestingStart + 86400 * (cliff - 1));
            expect(await powerloomNodes.vestedLegacyNodeTokens()).to.equal(0);

            // After cliff
            await time.increaseTo(vestingStart + 86400 * (cliff + 1));
            const initialClaim = (BigInt(nodeValue - sentOnL1) * BigInt(initialClaimPercentage)) / 1000000n;
            const vestedAmount = BigInt(nodeValue) - initialClaim;
            const expectedVested = vestedAmount * 1n / BigInt(vestingDays - cliff); // 1 day vested out of 335 (365 - 30) days
            expect(await powerloomNodes.vestedLegacyNodeTokens()).to.be.closeTo(expectedVested, ethers.parseEther("0.01"));

            // After full vesting period
            await time.increaseTo(vestingStart + 86400 * vestingDays);
            const expectedFullVested = BigInt(nodeValue) - initialClaim;
            expect(await powerloomNodes.vestedLegacyNodeTokens()).to.equal(expectedFullVested);
        });

        it("Should calculate claimable legacy node tokens correctly", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            
            const vestingStart = (await time.latest()) + 86400; // 1 day from now
            const nodeValue = ethers.parseEther("10");
            const initialClaimPercentage = 200000n;
            const vestingDays = 365n;
            const cliff = 30n;
            const nonKycedCooldown = 7n * 86400n;
            const sentOnL1 = ethers.parseEther("1");

            await powerloomNodes.connect(owner).configureLegacyNodes(
                100, initialClaimPercentage, cliff, nodeValue, vestingDays, 
                vestingStart, sentOnL1, nonKycedCooldown
            );

            // Mint a legacy node
            await powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, 1, true);
            const initialClaim = (BigInt(nodeValue) * BigInt(initialClaimPercentage)) / 1000000n;
            await powerloomNodes.connect(owner).deposit({ value: initialClaim });

            // Burn the node to start vesting
            await time.increaseTo(vestingStart);
            await powerloomNodes.connect(user1).burnNode(1);

            // Check claimable amount after cliff
            await time.increaseTo(vestingStart + 86400 * (Number(cliff) + 1));
            
            const nodeValueBigInt = BigInt(nodeValue);
            const tokensAfterInitialClaim = nodeValueBigInt - initialClaim;
            const expectedClaimable = (tokensAfterInitialClaim * 1n) / (vestingDays - cliff);

            expect(await powerloomNodes.claimableLegacyNodeTokens(1)).to.be.closeTo(expectedClaimable, ethers.parseEther("0.01"));
        });

        it("Should send the correct initial claim when a legacy node is burned", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            
            const vestingStart = (await time.latest()) + 86400; // 1 day from now
            const nodeValue = ethers.parseEther("10");
            const initialClaimPercentage = 200000;
            const vestingDays = 365;
            const cliff = 30;
            const nonKycedCooldown = 7 * 86400;
            const sentOnL1 = ethers.parseEther("1");

            await powerloomNodes.connect(owner).configureLegacyNodes(
                100, initialClaimPercentage, cliff, nodeValue, vestingDays, 
                vestingStart, sentOnL1, nonKycedCooldown
            );

            // Mint a legacy node
            const nodeId = 1;
            await powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, nodeId, true);
            const initialClaim = (BigInt(nodeValue - sentOnL1) * BigInt(initialClaimPercentage)) / 1000000n;
            await powerloomNodes.connect(owner).deposit({ value: initialClaim });

            // Burn the node to start vesting
            await time.increaseTo(vestingStart);
            await powerloomNodes.connect(user1).burnNode(nodeId);

            // Check initial claim
            const nodeIdToVestingInfo = await powerloomNodes.nodeIdToVestingInfo(nodeId);
            expect(nodeIdToVestingInfo.initialClaim).to.equal(initialClaim);

            // Should not send claim if node is not kyced
            const nodeId2 = 2;
            await powerloomNodes.connect(owner).adminMintLegacyNodes(user1.address, nodeId2, false);
            await powerloomNodes.connect(owner).deposit({ value: initialClaim });
            await expect(powerloomNodes.connect(user1).burnNode(nodeId2)).to.be.revertedWith("Non KYCed legacy nodes cannot be burned before lockup period");
        });

        it("Should allow standard node holders to claim their node tokens", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            const { nodeId } = await loadFixture(mintNodeFixture);

            const nodePrice = await powerloomNodes.nodePrice();
            const cooldownPeriod = 86400n; // 1 day in seconds

            // Set snapshotter token claim cooldown
            await powerloomNodes.setSnapshotterTokenClaimCooldown(cooldownPeriod);

            // Try to claim before burning (should fail)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.be.revertedWith("Need to Burn the Node First");

            // Burn the node
            await powerloomNodes.connect(user1).burnNode(nodeId);
            const nodeBurnedOn = (await powerloomNodes.nodeInfo(nodeId)).burnedOn;

            // Try to claim immediately after burning (should fail due to cooldown)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.be.revertedWith("Snapshotter token claim cooldown not yet met");

            // Advance time to just before cooldown ends
            const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
            const endTime = nodeBurnedOn + cooldownPeriod
            const timeToIncrease = BigInt(endTime) - BigInt(blockTimestamp) - BigInt(2);

            await time.increase(timeToIncrease);

            // Try to claim just before cooldown ends (should still fail)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.be.revertedWith("Snapshotter token claim cooldown not yet met");

            // Advance time to after cooldown
            await time.increase(2);

            // Try to claim with a different user (should fail)
            await expect(powerloomNodes.connect(owner).claimNodeTokens(nodeId))
                .to.be.revertedWith("Only the owner can claim their own tokens");

            // Claim tokens successfully
            const balanceBefore = await ethers.provider.getBalance(user1.address);
            await powerloomNodes.connect(owner).deposit({ value: nodePrice * 2n });
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.emit(powerloomNodes, "SnapshotterTokensClaimed")
                .withArgs(user1.address, nodeId, nodePrice);

            // Verify balance increase
            const balanceAfter = await ethers.provider.getBalance(user1.address);
            expect(balanceAfter).to.be.closeTo(balanceBefore + nodePrice, ethers.parseEther("0.001"));

            // Try to claim again (should fail)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.be.revertedWith("Tokens already claimed");
        });

        it("Should allow legacy node holders to claim their node tokens", async function () {
            const { powerloomNodes, user1, user2 } = await loadFixture(deployContractsFixture);

            // Configure legacy nodes
            const legacyNodeCount = 10;
            const legacyNodeInitialClaimPercentage = 200000; // 20%
            const legacyNodeCliff = 30; // 30 days
            const legacyNodeValue = ethers.parseEther("100");
            const legacyNodeVestingDays = 365;
            const legacyNodeVestingStart = await time.latest();
            const legacyTokensSentOnL1 = ethers.parseEther("0");
            const legacyNodeNonKycedCooldown = 60 * 60 * 24 * 30; // 30 days

            await powerloomNodes.configureLegacyNodes(
                legacyNodeCount,
                legacyNodeInitialClaimPercentage,
                legacyNodeCliff,
                legacyNodeValue,
                legacyNodeVestingDays,
                legacyNodeVestingStart,
                legacyTokensSentOnL1,
                legacyNodeNonKycedCooldown
            );

            // Mint legacy nodes
            await powerloomNodes.adminMintLegacyNodes(user1.address, 1, true); // KYCed node
            await powerloomNodes.adminMintLegacyNodes(user2.address, 1, false); // Non-KYCed node

            // Set snapshotter token claim cooldown
            const cooldownPeriod = 60 * 60 * 24 * 7; // 7 days
            await powerloomNodes.setSnapshotterTokenClaimCooldown(cooldownPeriod);

            // Test KYCed legacy node
            const kycedNodeId = 1;

            // Attempt to claim before burning (should fail)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(kycedNodeId))
                .to.be.revertedWith("Need to Burn the Node First");

            await powerloomNodes.deposit({ value: legacyNodeValue*2n });
                // Burn the node
            await powerloomNodes.connect(user1).burnNode(kycedNodeId);

            // Attempt to claim again immediately (should fail because of vesting)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(kycedNodeId))
                .to.be.revertedWith("No tokens to claim");

            // Move time forward 1 day past the cliff
            const cliff = legacyNodeCliff * 86400;
            const timeToIncrease = legacyNodeVestingStart + cliff + 86400;
            await time.increaseTo(timeToIncrease);

            const vestedAmount = await powerloomNodes.vestedLegacyNodeTokens();
            const initialClaim = (BigInt(legacyNodeValue - legacyTokensSentOnL1) * BigInt(legacyNodeInitialClaimPercentage)) / 1000000n;
            const totalValue = legacyNodeValue - initialClaim;
            const daysSinceVestingStarted = (BigInt(await time.latest()) - BigInt(legacyNodeVestingStart)) / 86400n;
            const daysAfterCliff = daysSinceVestingStarted - BigInt(legacyNodeCliff);
            const expectedVested = (totalValue * daysAfterCliff) / BigInt(legacyNodeVestingDays - legacyNodeCliff);
            expect(vestedAmount).to.equal(expectedVested);

            // Claim again (should succeed)
            const secondClaimTx = await powerloomNodes.connect(user1).claimNodeTokens(kycedNodeId);
            await expect(secondClaimTx)
                .to.emit(powerloomNodes, "LegacyNodeTokensClaimed");

            // Check vesting info
            const vestingInfo = await powerloomNodes.nodeIdToVestingInfo(kycedNodeId);
            expect(vestingInfo.initialClaim).to.equal(initialClaim);
            expect(vestingInfo.tokensClaimed).to.be.closeTo(expectedVested, ethers.parseEther("0.0001"));

            // Test non-KYCed legacy node
            const nonKycedNodeId = 2;

            // Attempt to claim before burning (should fail)
            await expect(powerloomNodes.connect(user2).claimNodeTokens(nonKycedNodeId))
                .to.be.revertedWith("Need to Burn the Node First");

            // Burn the node
            await expect(powerloomNodes.connect(user2).burnNode(nonKycedNodeId)).to.emit(powerloomNodes, "NodeBurned");

            const claimTxNonKyced = await powerloomNodes.connect(user2).claimNodeTokens(nonKycedNodeId);
            await expect(claimTxNonKyced)
                .to.emit(powerloomNodes, "LegacyNodeTokensClaimed")
                .withArgs(user2.address, nonKycedNodeId, legacyNodeValue);

        });

        it("Should prevent claiming of node tokens when the contract is paused", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            const { nodeId } = await loadFixture(mintNodeFixture);

            // Pause the contract
            await powerloomNodes.connect(owner).pause();

            // Try to claim node tokens (should fail)
            await expect(powerloomNodes.connect(user1).claimNodeTokens(nodeId))
                .to.be.revertedWithCustomError(powerloomNodes, "EnforcedPause");
        });
        
    });

    describe("Emergency Withdraw", function () {
        it("Should allow the owner to emergency withdraw power", async function () {
            const { powerloomNodes, owner, user1 } = await loadFixture(deployContractsFixture);
            
            const depositAmount = ethers.parseEther("10");
            await powerloomNodes.connect(owner).deposit({ value: depositAmount });
            expect(await ethers.provider.getBalance(powerloomNodes.getAddress())).to.equal(depositAmount);

            // Emergency withdraw
            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await powerloomNodes.connect(owner).emergencyWithdraw();
            const balanceAfter = await ethers.provider.getBalance(owner.address);
            expect(balanceAfter).to.be.closeTo(balanceBefore + depositAmount, ethers.parseEther("0.001"));
            expect(await ethers.provider.getBalance(powerloomNodes.getAddress())).to.equal(0);

            // non-owner should not be able to emergency withdraw
            await expect(powerloomNodes.connect(user1).emergencyWithdraw())
                .to.be.revertedWithCustomError(powerloomNodes, "OwnableUnauthorizedAccount");
        });
    });
    

});
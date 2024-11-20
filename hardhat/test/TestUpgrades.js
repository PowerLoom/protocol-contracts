const { expect, should } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("PowerloomProtocolState Upgrade", function () {
    let PowerloomProtocolState, PowerloomProtocolStateV2, protocolStateProxy, upgradedProtocol, deployer, other;

    before(async function () {
        [deployer, other] = await ethers.getSigners();

        // Deploy the initial version of the contract
        PowerloomProtocolState = await ethers.getContractFactory("PowerloomProtocolState");
        protocolStateProxy = await upgrades.deployProxy(PowerloomProtocolState, [deployer.address]);
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
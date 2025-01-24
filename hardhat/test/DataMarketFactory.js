const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("DataMarket Deployment", function () {
  let deployer;
  let SnapshotterState, snapshotterState;
  let DataMarketFactory, dataMarketFactory;
  let ProxyV2, proxyContract;

  beforeEach(async function () {
    [deployer] = await ethers.getSigners();

    SnapshotterState = await ethers.getContractFactory("PowerloomNodes");
    snapshotterState = await SnapshotterState.deploy();
    await snapshotterState.waitForDeployment();

    DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
    dataMarketFactory = await DataMarketFactory.deploy();
    await dataMarketFactory.waitForDeployment();

    ProxyV2 = await ethers.getContractFactory("PowerloomProtocolState");
    proxyContract = await upgrades.deployProxy(ProxyV2, [deployer.address]);
    await proxyContract.waitForDeployment();

    const storageChangeTx = await proxyContract.updateSnapshotterState(await snapshotterState.getAddress());
    await storageChangeTx.wait();

    const dmFactoryChangeTx = await proxyContract.updateDataMarketFactory(await dataMarketFactory.getAddress());
    await dmFactoryChangeTx.wait();
  });

  it("should create a DataMarket", async function () {
    const dataMarketTx = await proxyContract.createDataMarket(deployer.address, 1, 137, 2, true);
    const receipt = await dataMarketTx.wait();
    expect(receipt.status).to.equal(1);
  });

  it("should correctly set the data market count and addresses in ProtocolState", async function () {
    const dataMarketAddress = await proxyContract.dataMarketIdToAddress(1);

    const protocolStateAddress = await proxyContract.dataMarkets(dataMarketAddress);
    expect(protocolStateAddress).to.not.equal(ethers.ZeroAddress);
  });

  it("Should release Event if data market is created", async function () {
    const dataMarketCreatedEventSig = "DataMarketCreated(address indexed ownerAddress, uint8 epochSize, uint256 sourceChainId, uint256 sourceChainBlockTime, bool useBlockNumberAsEpochId, address protocolState, address dataMarketAddress)";
    await expect(proxyContract.createDataMarket(deployer.address, 1, 137, 2, true)).to.emit(dataMarketFactory, dataMarketCreatedEventSig);
  });
    
  it("Should deploy an implementation contract on creation", async function () {
    const dataMarketContract = await ethers.getContractFactory("PowerloomDataMarket");
    const dataMarket = await dataMarketContract.deploy();
    await dataMarket.waitForDeployment();
    expect(dataMarket.target).to.not.equal(ethers.ZeroAddress);
  });

  
});

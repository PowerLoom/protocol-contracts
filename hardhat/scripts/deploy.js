require('dotenv').config()
const { ethers, upgrades } = require("hardhat");

// scripts/deploy.js
async function main() {

  // You need to setup private key in network config in hardhat.config.js
  // for the deployer account which you want to use on that network
  const [deployer] = await ethers.getSigners();

  const owner = process.env.OWNER_ADDRESS ? process.env.OWNER_ADDRESS : deployer.address;
  const epochSize = Number(process.env.EPOCH_SIZE);
  const sourceChainId = Number(process.env.SOURCE_CHAIN_ID);
  const sourceChainBlockTime = Number(process.env.SOURCE_CHAIN_BLOCK_TIME);
  const useBlockNumberAsEpochId = process.env.USE_BLOCK_NUMBER_AS_EPOCH_ID === 'true';

  const DATA_MARKET_INPUT_PARAMS = [
    owner,
    epochSize,
    sourceChainId,
    sourceChainBlockTime,
    useBlockNumberAsEpochId
  ];

  const DATA_MARKET_SEQUENCER_LIST = JSON.parse(process.env.DATA_MARKET_SEQUENCER_LIST);

  const DATA_MARKET_EPOCH_MANAGER = process.env.DATA_MARKET_EPOCH_MANAGER;
  const DATA_MARKET_VALIDATORS = JSON.parse(process.env.DATA_MARKET_VALIDATORS);

  const DATA_MARKET_SNAPSHOT_SUBMISSION_WINDOW = Number(process.env.DATA_MARKET_SNAPSHOT_SUBMISSION_WINDOW);
  const DATA_MARKET_BATCH_SUBMISSION_WINDOW = Number(process.env.DATA_MARKET_BATCH_SUBMISSION_WINDOW);
  const DATA_MARKET_ATTESTATION_SUBMISSION_WINDOW = Number(process.env.DATA_MARKET_ATTESTATION_SUBMISSION_WINDOW);
  const SNAPSHOTTER_STATE_ADMINS = JSON.parse(process.env.SNAPSHOTTER_STATE_ADMINS);
  const SNAPSHOTTER_STATE_INITIAL_NODE_PRICE = BigInt(process.env.SNAPSHOTTER_STATE_INITIAL_NODE_PRICE);
  const SNAPSHOTTER_STATE_INITIAL_NAME = process.env.SNAPSHOTTER_STATE_INITIAL_NAME;
  const DAILY_SNAPSHOT_QUOTA = Number(process.env.DAILY_SNAPSHOT_QUOTA);
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy the storage contract
  const PowerloomNodes = await ethers.getContractFactory("PowerloomNodes");
  const storageContract = await upgrades.deployProxy(PowerloomNodes, 
    [owner, SNAPSHOTTER_STATE_INITIAL_NODE_PRICE, SNAPSHOTTER_STATE_INITIAL_NAME]
  );
  await storageContract.waitForDeployment();
  console.log("PowerloomNodes deployed to:", await storageContract.getAddress());

  const adminValues = Array(SNAPSHOTTER_STATE_ADMINS.length).fill(true);
  await (await storageContract.updateAdmins(SNAPSHOTTER_STATE_ADMINS, adminValues)).wait();
  console.log("SnapshotterState admins updated to:", await storageContract.getAdmins());

  // Deploy the data market factory contract
  const DataMarketFactory = await ethers.getContractFactory("DataMarketFactory");
  const dataMarketFactory = await DataMarketFactory.deploy();
  await dataMarketFactory.waitForDeployment();
  console.log("DataMarketFactory deployed to:", await dataMarketFactory.getAddress());

  // Deploy the proxy contract
  const ProxyV2 = await ethers.getContractFactory("PowerloomProtocolState");
  const proxyContract = await upgrades.deployProxy(ProxyV2, [owner]);

  // For upgrades use below code in comment
  // const proxyContract = await upgrades.upgradeProxy(CURRENT_PROXY_ADDRESS, ProxyV2);
  await proxyContract.waitForDeployment();
  console.log("Proxy for protocol state deployed to:", await proxyContract.getAddress());

  // Set snapshotter state address in protocol state
  await (await proxyContract.updateSnapshotterState(await storageContract.getAddress())).wait();
  console.log("Storage address set in ProtocolState: ", await proxyContract.snapshotterState());

  await (await proxyContract.updateDataMarketFactory(await dataMarketFactory.getAddress())).wait();
  console.log("DataMarketFactory address set in ProtocolState: ", await proxyContract.dataMarketFactory());

  await (await proxyContract.createDataMarket(...DATA_MARKET_INPUT_PARAMS)).wait();
  console.log("DataMarket created at: ", await proxyContract.dataMarketIdToAddress(1));

  // Attach to DataMarket contract deployed via Protocol State
  const DataMarketContractFactory = await ethers.getContractFactory("PowerloomDataMarket");
  const dataMarket = DataMarketContractFactory.attach(await proxyContract.dataMarketIdToAddress(1));

  const sequencerListValues = Array(DATA_MARKET_SEQUENCER_LIST.length).fill(true);
  await (await dataMarket.updateAddresses(1, DATA_MARKET_SEQUENCER_LIST, sequencerListValues)).wait();
  console.log("DataMarket sequencer list updated to:", await dataMarket.getSequencers());

  await (await dataMarket.updateEpochManager(DATA_MARKET_EPOCH_MANAGER)).wait();
  console.log("DataMarket epochManager updated to:", await dataMarket.epochManager());

  const validatorValues = Array(DATA_MARKET_VALIDATORS.length).fill(true);
  await (await dataMarket.updateAddresses(0, DATA_MARKET_VALIDATORS, validatorValues)).wait();
  console.log("DataMarket validators updated to:", await dataMarket.getValidators());

  await (await dataMarket.updateSnapshotSubmissionWindow(DATA_MARKET_SNAPSHOT_SUBMISSION_WINDOW)).wait();
  console.log("DataMarket snapshotSubmissionWindow updated to:", await dataMarket.snapshotSubmissionWindow());

  await (await dataMarket.updateAttestationSubmissionWindow(DATA_MARKET_ATTESTATION_SUBMISSION_WINDOW)).wait();
  console.log("DataMarket attestationSubmissionWindow updated to:", await dataMarket.attestationSubmissionWindow());

  await (await dataMarket.updateBatchSubmissionWindow(DATA_MARKET_BATCH_SUBMISSION_WINDOW)).wait();
  console.log("DataMarket batchSubmissionWindow updated to:", await dataMarket.batchSubmissionWindow());

  await (await dataMarket.updateDailySnapshotQuota(DAILY_SNAPSHOT_QUOTA)).wait();
  console.log("DataMarket dailySnapshotQuota updated to:", await dataMarket.dailySnapshotQuota());

  console.log("DataMarket owner: ", await dataMarket.owner());
  console.log("DataMarket epochSize: ", await dataMarket.EPOCH_SIZE());
  console.log("DataMarket sourceChainId: ", await dataMarket.SOURCE_CHAIN_ID());
  console.log("DataMarket sourceChainBlockTime: ", await dataMarket.SOURCE_CHAIN_BLOCK_TIME());
  console.log("DataMarket useBlockNumberAsEpochId: ", await dataMarket.USE_BLOCK_NUMBER_AS_EPOCH_ID());
  console.log("DataMarket protocolState: ", await dataMarket.protocolState());
  console.log("DataMarket snapshotSubmissionWindow: ", await dataMarket.snapshotSubmissionWindow());
  console.log("DataMarket batchSubmissionWindow: ", await dataMarket.batchSubmissionWindow());
  console.log("DataMarket attestationSubmissionWindow: ", await dataMarket.attestationSubmissionWindow());
  console.log("DataMarket sequencer list:", await dataMarket.getSequencers());
  console.log("DataMarket epochManager: ", await dataMarket.epochManager());
  console.log("DataMarket validators: ", await dataMarket.getValidators());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
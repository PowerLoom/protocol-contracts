require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');
require("@nomicfoundation/hardhat-verify");
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: process.env.SOLIDITY_VERSION,
    settings: {
      optimizer: {
        enabled: !!process.env.SOLIDITY_OPTIMIZER_RUNS,
        runs: Number(process.env.SOLIDITY_OPTIMIZER_RUNS),
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    'conduit': {
      url: process.env.RPC_URL_CONDUIT,
      chainId: Number(process.env.CHAIN_ID_CONDUIT),
      accounts: [process.env.PRIVATE_KEY],
      gas: 2100000,
      gasPrice: 1000000000
    }
  },
  etherscan: {
    apiKey: {
      'conduit': "abc"
    },
    customChains: [
      {
        network: "conduit",
        chainId: Number(process.env.CHAIN_ID_CONDUIT),
        urls: {
          apiURL: process.env.EXPLORER_API_URL_CONDUIT,
          browserURL: process.env.EXPLORER_URL_CONDUIT,
        }
      }
    ]
  },

  gasReporter: {
    enabled: !process.env.REPORT_GAS
  }
};
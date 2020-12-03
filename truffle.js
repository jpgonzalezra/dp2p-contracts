const HDWalletProvider = require('truffle-hdwallet-provider');
require('dotenv').config();

module.exports = {
  networks: {
    ropsten: {
      provider: function () {
        return new HDWalletProvider(
          `${process.env.PRIVATE_KEY}`,
          `https://ropsten.infura.io/v3/${process.env.INFURA_API_KEY}`
        );
      },
      gasPrice: 90000000000,
      network_id: 3, // eslint-disable-line camelcase
    },
  },
  mocha: {
    reporter: 'eth-gas-reporter',
  },
  plugins: [
    'truffle-plugin-verify',
    'solidity-coverage',
  ],
  api_keys: { // eslint-disable-line camelcase
    etherscan: process.env.ETHERSCAN_API_KEY,
  },
  compilers: {
    solc: {
      version: '0.6.12',
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: 'petersburg',
      },
    },
  },
};

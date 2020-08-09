const HDWalletProvider = require("truffle-hdwallet-provider");

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // eslint-disable-line camelcase
    },
    ropsten: {
      provider: function() {
        return new HDWalletProvider("0x36797df5163dda5138253414fc3918ab3a352165261de2fea109a68ee84b4110", "https://ropsten.infura.io/v3/f039330d8fb747e48a7ce98f51400d65")
      },
      gasPrice: 90000000000,
      network_id: 3
    }
  },
  compilers: {
    solc: {
      version: '0.6.2',
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

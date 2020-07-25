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
        return new HDWalletProvider("0x6365b6515d20004503c3d6e87226880c9903f17283d9cd4ee4d02c90b3f2b5b0", "https://ropsten.infura.io/v3/f039330d8fb747e48a7ce98f51400d65")
      },
      gasPrice: 40000000000,
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

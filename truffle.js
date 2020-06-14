const HDWalletProvider = require("truffle-hdwallet-provider");
const MNEMONIC = "digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six"

module.exports = {
  networks: {
    development: {
      host: 'localhost',
      port: 7545,
      network_id: '*', // eslint-disable-line camelcase
    },
    ropsten: {
      provider: function() {
        return new HDWalletProvider(MNEMONIC, "https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b")
      },
      network_id: 3
    }
  },
  compilers: {
    solc: {
      version: '0.6.4',
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

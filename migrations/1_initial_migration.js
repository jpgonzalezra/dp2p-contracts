const TestToken = artifacts.require("mocks/TestToken"); // 18 digits
const TestToken2 = artifacts.require("mocks/TestToken2"); // 8 digits
const Stablescrow = artifacts.require("Stablescrow");

module.exports = function (deployer) {
  // Deployer is the Truffle wrapper for deploying
  // contracts to the network

  // Deploy the contract to the network
  deployer.deploy(TestToken);
  deployer.deploy(TestToken2);
  deployer.deploy(Stablescrow);
};

const TestToken = artifacts.require("TestToken");
const TestToken2 = artifacts.require("TestToken2");
const TestToken3 = artifacts.require("TestToken3");
const Stablescrow = artifacts.require("Stablescrow");

module.exports = function (deployer) {
  // Deployer is the Truffle wrapper for deploying
  // contracts to the network

  // Deploy the contract to the network
  deployer.deploy(TestToken);
  deployer.deploy(Stablescrow);
  deployer.deploy(TestToken2);
  deployer.deploy(TestToken3);
};

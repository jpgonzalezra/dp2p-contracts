const TestToken = artifacts.require("TestToken");
const Stablescrow = artifacts.require("Stablescrow");

module.exports = function(deployer) {
    // Deployer is the Truffle wrapper for deploying
    // contracts to the network

    // Deploy the contract to the network
    deployer.deploy(TestToken);
    deployer.deploy(Stablescrow);

}
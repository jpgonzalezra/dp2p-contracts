// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;


interface IDP2P {
    function createAndDeposit(
        uint256 _amount,
        address _agent,
        address _buyer,
        address _token,
        uint256 _salt
    ) external returns (bytes32 id);
}

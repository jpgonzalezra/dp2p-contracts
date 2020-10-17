// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interfaces/IDai.sol";
import "./DP2P.sol";

// WIP
contract DP2PDai is DP2P {
    address public daiAddress; // TODO: dai address here as a constant! 

    constructor(address _daiAddress) public { // TODO: remove this constructor
        require(_daiAddress != address(0), "Constructor/invalid-address");
        daiAddress = _daiAddress;
    }

    function createAndDepositWithPermit(
        uint256 _amount,
        address _agent,
        address _buyer,
        uint8 _limit,
        uint256 _nonce,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external returns (bytes32) {
        IDai(daiAddress).permit(
            msg.sender,
            address(this),
            _nonce,
            0,
            true,
            _v,
            _r,
            _s
        );
        return createAndDeposit(
                _amount,
                _agent,
                _buyer,
                daiAddress,
                _limit,
                _nonce
            );
    }
}

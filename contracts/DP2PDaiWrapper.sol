// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interfaces/IDai.sol";
import "./interfaces/IDP2P.sol";

contract DP2PDaiWrapper {
    address public dp2pAddress;
    address public daiAddress;
    uint256 internal constant MAX_INT = uint256(-1);

    constructor(address _dp2pAddress, address _daiAddress) public {
        require(_dp2pAddress != address(0), "Constructor/invalid-address");
        require(_daiAddress != address(0), "Constructor/invalid-address");
        dp2pAddress = _dp2pAddress;
        daiAddress = _daiAddress;
    }

    function createAndDeposit(
        uint256 _amount,
        address _agent,
        address _buyer,
        address _token,
        uint256 _nonce,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external returns (bytes32) {
        IDai(daiAddress).permit(
            msg.sender,
            dp2pAddress,
            _nonce,
            0,
            true,
            _v,
            _r,
            _s
        );
        return
            IDP2P(dp2pAddress).createAndDeposit(
                _amount,
                _agent,
                _buyer,
                _token,
                _nonce
            );
    }
}

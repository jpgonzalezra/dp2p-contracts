// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IDai {
    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function nonces(address signer) external returns (uint256);
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";

contract IMerkleDistributorManager {
    struct Distribution {
        address token;
        bytes32 merkleRoot;
        uint256 remainingAmount;
    }

    mapping(uint64 => Distribution) public distributionMap;

    // This is a packed array of booleans.
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    function token(uint64 campaignId) external view returns(address) {
        return distributionMap[campaignId].token;
    }

    function merkleRoot(uint64 campaignId) external view returns(bytes32) {
        return distributionMap[campaignId].merkleRoot;
    }

    function remainingAmount(uint64 campaignId) external view returns(uint256) {
        return distributionMap[campaignId].remainingAmount;
    }

    function isClaimed(uint64 campaignId, uint256 index) public view returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[campaignId][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint64 campaignId, uint256 index) internal {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        claimedBitMap[campaignId][claimedWordIndex] =
        claimedBitMap[campaignId][claimedWordIndex] | (1 << claimedBitIndex);
    }

    event Claimed(uint64 campaignId, uint256 index, address account, uint256 amount);
}

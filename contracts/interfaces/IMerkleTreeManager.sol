// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../SafeMath64.sol";

contract IMerkleTreeManager {
    using SafeMath64 for uint64;

    uint64 public nextTreeId = 1;
    mapping(uint64 => bytes32) public merkleRootMap;

    // This is a packed array of booleans.
    mapping(uint256 => mapping(uint256 => uint256)) private provenBitMap;

    function merkleRoot(uint64 tokenId) external view returns (bytes32) {
        return merkleRootMap[tokenId];
    }

    function isProven(uint64 treeId, uint256 index) public view returns (bool) {
        uint256 provenWordIndex = index / 256;
        uint256 provenBitIndex = index % 256;
        uint256 provenWord = provenBitMap[treeId][provenWordIndex];
        uint256 mask = (1 << provenBitIndex);
        return provenWord & mask == mask;
    }

    function _setProven(uint64 treeId, uint256 index) internal {
        uint256 provenWordIndex = index / 256;
        uint256 provenBitIndex = index % 256;
        provenBitMap[treeId][provenWordIndex] =
        provenBitMap[treeId][provenWordIndex] | (1 << provenBitIndex);
    }

    function addTree(bytes32 newMerkleRoot) public {
        merkleRootMap[nextTreeId] = newMerkleRoot;
        nextTreeId = nextTreeId.add(1);
    }
}

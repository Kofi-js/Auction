import { ethers } from "hardhat";
import fs from "fs";

// Utility function to get deployed addresses
async function getDeployedAddresses() {
  const network = process.env.HARDHAT_NETWORK || "localhost";
  const deploymentPath = `./deployments/${network}.json`;
  
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`No deployment found for network ${network}`);
  }
  
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

// Create a new auction
async function createAuction() {
  const { mockNFT: nftAddress, sealedBidAuction: auctionAddress } = await getDeployedAddresses();
  
  const nft = await ethers.getContractAt("OnChainNFT", nftAddress);
  const auction = await ethers.getContractAt("SealedBidAuction", auctionAddress);

  // Get signers
  const [owner, seller] = await ethers.getSigners();

  // Mint NFT to seller
  console.log("\nMinting NFT to seller...");
  await nft.connect(owner).mint(seller.address, 1);
  
  // Approve auction contract
  console.log("Approving auction contract...");
  await nft.connect(seller).approve(auctionAddress, 1);

  const minPrice = ethers.parseEther("1");
  const biddingTime = 3600; // 1 hour
  const revealTime = 1800; // 30 minutes

  console.log("Creating auction...");
  const tx = await auction.connect(seller).createAuction(
    nftAddress,
    1,
    minPrice,
    biddingTime,
    revealTime
  );

  const receipt = await tx.wait();
  if (receipt) {
    const event = receipt.events?.find(e => e.event === "AuctionCreated");
    const auctionId = event?.args?.auctionId;
    console.log(`Auction created! ID: ${auctionId}, Transaction: ${receipt.hash}`);
    return auctionId;
  } else {
    throw new Error("Failed to create auction, receipt is null");
  }
}

// Submit a bid
async function submitBid(auctionId: number, bidAmount: string) {
  const { sealedBidAuction: auctionAddress } = await getDeployedAddresses();
  const auction = await ethers.getContractAt("SealedBidAuction", auctionAddress);
  const [_, __, bidder] = await ethers.getSigners();

  const amount = ethers.parseEther(bidAmount);
  const nonce = ethers.randomBytes(32);
  const commitment = await auction.generateCommitment(amount, nonce);

  console.log("\nSubmitting bid...");
  const tx = await auction.connect(bidder).commitBid(auctionId, commitment, {
    value: amount
  });

  const receipt = await tx.wait();
  if (receipt) {
    console.log(`Bid submitted! Transaction: ${receipt.hash}`);
    return { amount, nonce, commitment };
  } else {
    throw new Error("Failed to submit bid, receipt is null");
  }
}

// Reveal a bid
async function revealBid(auctionId: number, amount: bigint, nonce: Uint8Array) {
  const { sealedBidAuction: auctionAddress } = await getDeployedAddresses();
  const auction = await ethers.getContractAt("SealedBidAuction", auctionAddress);
  const [_, __, bidder] = await ethers.getSigners();

  console.log("\nRevealing bid...");
  const tx = await auction.connect(bidder).revealBid(auctionId, amount, nonce);

  const receipt = await tx.wait();
  if (receipt) {
    console.log(`Bid revealed! Transaction: ${receipt.hash}`);
  } else {
    throw new Error("Failed to reveal bid, receipt is null");
  }
}

// End auction
async function endAuction(auctionId: number) {
  const { sealedBidAuction: auctionAddress } = await getDeployedAddresses();
  const auction = await ethers.getContractAt("SealedBidAuction", auctionAddress);

  console.log("\nEnding auction...");
  const tx = await auction.endAuction(auctionId);

  const receipt = await tx.wait();
  if (receipt) {
    const event = receipt.events?.find(e => e.event === "AuctionEnded");
    console.log(`Auction ended! Winner: ${event?.args?.winner}, Amount: ${ethers.formatEther(event?.args?.amount)} ETH`);
  } else {
    throw new Error("Failed to end auction, receipt is null");
  }
}

// Main function to run all interactions
async function main() {
  try {
    // Create an auction
    console.log("\nCreating new auction...");
    const auctionId = await createAuction();

    // Submit a bid
    console.log("\nSubmitting bid...");
    const bidData = await submitBid(auctionId, "2.0");

    // Fast forward time for testing (only works on local network)
    const provider = ethers.provider;
    await provider.send("evm_increaseTime", [3601]); // Fast forward past bidding period
    await provider.send("evm_mine", []);

    // Reveal the bid
    console.log("\nRevealing bid...");
    await revealBid(auctionId, bidData.amount, bidData.nonce);

    // Fast forward time again
    await provider.send("evm_increaseTime", [1801]); // Fast forward past reveal period
    await provider.send("evm_mine", []);

    // End the auction
    console.log("\nEnding auction...");
    await endAuction(auctionId);

  } catch (error) {
    console.error("Error:", error);
    process.exitCode = 1;
  }
}

// Execute if running this script directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

describe("SealedBidAuction", () => {
  // Basic fixture to deploy contracts and setup auction
  async function deployAuctionFixture() {
    const [owner, seller, bidder1, bidder2] = await hre.ethers.getSigners();

    // Deploy NFT and Auction contracts
    const NFT = await hre.ethers.getContractFactory('OnChainNFT');
    const nft = await NFT.deploy(owner,"Suspicious","SUS");

    const SealedBidAuction = await hre.ethers.getContractFactory('SealedBidAuction');
    const auction = await SealedBidAuction.deploy();

    // Setup initial auction
    await nft.safeMint(seller.address,1);
    await nft.connect(seller).approve(await auction.getAddress(), 1);

    const tx = await auction.connect(seller).createAuction(
        await nft.getAddress(),
        1,
        hre.ethers.parseEther("1"),
        3600n,
        1800n
      );
      
      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }
      
      // Correctly parse the event using the contract's filter
      const filter = auction.filters.AuctionCreated();
      const events = await auction.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      if (events.length === 0) {
        throw new Error("AuctionCreated event not emitted");
      }
      const auctionId = events[0].args.auctionId;
    return {auction, nft, auctionId,owner, seller,bidder1, bidder2};
  }

  describe("Auction Flow", () => {
    it("Should allow bid commitments and reveals", async () => {
      const { auction, nft, auctionId, bidder1 } = await loadFixture(deployAuctionFixture);

      // Submit bid
      const bidAmount = hre.ethers.parseEther("2");
      const nonce = hre.ethers.randomBytes(32);
      const commitment = await auction.generateCommitment(bidAmount, nonce);

      await auction.connect(bidder1).commitBid(auctionId, commitment, {
        value: bidAmount
      });

      // Move past bidding period
      await time.increase(3601);

      // Reveal bid
      await auction.connect(bidder1).revealBid(auctionId, bidAmount, nonce);

      // Move past reveal period
      await time.increase(1801);

      // End auction
      await auction.endAuction(auctionId);

      // Verify winner
      expect(await nft.ownerOf(1)).to.equal(bidder1.address);
    });

    it("Should select highest bidder as winner", async () => {
      const { auction, nft, auctionId, bidder1, bidder2 } = await loadFixture(deployAuctionFixture);

      // Bidder 1 bids 2 ETH
      const bid1 = {
        amount: hre.ethers.parseEther("2"),
        nonce: hre.ethers.randomBytes(32)
      };
      const commitment1 = await auction.generateCommitment(bid1.amount, bid1.nonce);
      await auction.connect(bidder1).commitBid(auctionId, commitment1, { value: bid1.amount });

      // Bidder 2 bids 3 ETH
      const bid2 = {
        amount: hre.ethers.parseEther("3"),
        nonce: hre.ethers.randomBytes(32)
      };
      const commitment2 = await auction.generateCommitment(bid2.amount, bid2.nonce);
      await auction.connect(bidder2).commitBid(auctionId, commitment2, { value: bid2.amount });

      // Move to reveal phase
      await time.increase(3601);

      // Reveal bids
      await auction.connect(bidder1).revealBid(auctionId, bid1.amount, bid1.nonce);
      await auction.connect(bidder2).revealBid(auctionId, bid2.amount, bid2.nonce);

      // End auction
      await time.increase(1801);
      await auction.endAuction(auctionId);

      // Verify bidder2 (highest bid) won
      expect(await nft.ownerOf(1)).to.equal(bidder2.address);
    });
  });

  describe("Error Handling", () => {
    it("Should not allow late bids", async () => {
      const { auction, auctionId, bidder1 } = await loadFixture(deployAuctionFixture);

      await time.increase(3601); // Past bidding period

      const bidAmount = hre.ethers.parseEther("2");
      const nonce = hre.ethers.randomBytes(32);
      const commitment = await auction.generateCommitment(bidAmount, nonce);

      await expect(
        auction.connect(bidder1).commitBid(auctionId, commitment, { value: bidAmount })
      ).to.be.revertedWithCustomError(auction, "BiddingPeriodEnded");
    });

    it("Should not allow early reveals", async () => {
      const { auction, auctionId, bidder1 } = await loadFixture(deployAuctionFixture);

      const bidAmount = hre.ethers.parseEther("2");
      const nonce = hre.ethers.randomBytes(32);
      const commitment = await auction.generateCommitment(bidAmount, nonce);

      await auction.connect(bidder1).commitBid(auctionId, commitment, { value: bidAmount });

      await expect(
        auction.connect(bidder1).revealBid(auctionId, bidAmount, nonce)
      ).to.be.revertedWithCustomError(auction, "BiddingPeriodNotEnded");
    });
  });
});
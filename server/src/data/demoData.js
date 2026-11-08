// Demo business data for NovaCart
export const BUSINESS_INFO = {
  name: "NovaCart",
  tagline: "Your Everyday Premium Marketplace",
  supportEmail: "support@novacart.demo",
  supportPhone: "+1 (800) 555-NOVA",
  operatingHours: "24/7 AI-assisted & 9:00 AM - 8:00 PM EST Human Support",
  policies: [
    {
      id: "pol_1",
      topic: "Delivery Timeframe",
      rule: "Standard delivery takes 4–6 business days from the dispatch date.",
      actionGuideline: "Check warehouse dispatch logs before confirming or promising revised delivery times."
    },
    {
      id: "pol_2",
      topic: "Refund Window",
      rule: "Customers can request a return and refund within 7 days of confirmed delivery.",
      actionGuideline: "Calculate days since delivery. If within 7 days, guide customer to return verification."
    },
    {
      id: "pol_3",
      topic: "Refund Verification",
      rule: "Refund requests require internal verification and receipt of the item at the returns hub.",
      actionGuideline: "Never promise immediate disbursement or compensation without manager/system verification."
    },
    {
      id: "pol_4",
      topic: "Order Cancellation",
      rule: "Orders can only be cancelled before dispatch. Once dispatched or in transit, customer must initiate a return upon receipt.",
      actionGuideline: "Check order status. If 'In Transit' or 'Dispatched', explain the post-delivery return procedure."
    },
    {
      id: "pol_5",
      topic: "Damaged or Wrong Products",
      rule: "Damaged or wrong products require supporting photographs and order invoice verification for immediate free replacement or return label.",
      actionGuideline: "Politely request photo proof of the received item and outer box barcode."
    },
    {
      id: "pol_6",
      topic: "Commitments & Guarantees",
      rule: "Delivery estimates and monetary credits must be verified by warehouse or finance before being promised.",
      actionGuideline: "Never invent or promise specific refund dates or arrival times without verified confirmation."
    }
  ]
};

export const DEMO_CUSTOMERS = [
  {
    id: "cust_aarav",
    name: "Aarav Sharma",
    email: "aarav.sharma@example.com",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
    order: {
      orderId: "NC1021",
      product: "Running Shoes (NovaSprint Pro - Blue/Grey)",
      price: 119.99,
      status: "Delayed",
      purchaseDate: "Nov 2, 2026",
      estimatedDelivery: "Nov 5, 2026",
      carrier: "FedEx Express",
      trackingNumber: "TRK-NC-882910",
      trackingStatus: "Package held at regional logistics hub due to customs clearance check",
      reportedIssue: "Delivery delay - Customer has not received shoes 3 days past the promised estimate",
      initialMessage: "Hi, I ordered the NovaSprint Pro shoes 6 days ago (Order NC1021) and the tracking hasn't moved since yesterday. It was supposed to be here Nov 5th! Can you check what's going on?"
    },
    ticket: {
      id: "tkt_1021",
      orderId: "NC1021",
      category: "Delivery Delay",
      priority: "High",
      sentiment: "Frustrated",
      status: "Human Assistance Requested",
      lastUpdated: new Date(Date.now() - 1000 * 60 * 12).toISOString(), // 12 mins ago
      humanRequested: true,
      summary: "Customer ordered NovaSprint Pro Running Shoes (NC1021) on Nov 2. Package is delayed at the regional logistics hub. Customer is frustrated about missing the Nov 5 delivery target.",
      suggestedReply: "Hello Aarav, I sincerely apologize for the delay with your NovaSprint Pro shoes (Order #NC1021). I just checked our courier dispatch system: your package is currently at the regional distribution center undergoing a transit scan. Standard delivery takes 4–6 business days, and while your order was delayed by unexpected hub congestion, I have flagged it for priority movement. I will monitor this shipment and update you within 24 hours.",
      pendingAction: "Agent needs to coordinate with courier hub and confirm priority tracking dispatch."
    }
  },
  {
    id: "cust_priya",
    name: "Priya Mehta",
    email: "priya.mehta@example.com",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
    order: {
      orderId: "NC1022",
      product: "Smartwatch (NovaPulse Smartwatch - Obsidian)",
      price: 249.50,
      status: "Delivered",
      purchaseDate: "Nov 4, 2026",
      deliveredDate: "Nov 6, 2026",
      carrier: "UPS Next Day",
      trackingNumber: "TRK-NC-773821",
      trackingStatus: "Delivered at front porch - signed by resident",
      reportedIssue: "Refund request - Device size doesn't fit wrist comfortably",
      initialMessage: "Hello, I received the NovaPulse Smartwatch (Order NC1022) two days ago. It is too bulky for my wrist and I would like to return it for a refund. How do I start the return process?"
    },
    ticket: {
      id: "tkt_1022",
      orderId: "NC1022",
      category: "Refund Request",
      priority: "Medium",
      sentiment: "Neutral",
      status: "Open",
      lastUpdated: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45 mins ago
      humanRequested: false,
      summary: "Customer received the NovaPulse Smartwatch (NC1022) on Nov 6 (2 days ago, within our 7-day refund window). Wants to return for a full refund due to ergonomic fit.",
      suggestedReply: "Hi Priya, thank you for reaching out! You are well within NovaCart's 7-day return window since your smartwatch was delivered on November 6th. According to our return policy, refunds are processed once the item is inspected at our returns hub in its original packaging. I can generate a pre-paid return shipping label for you right away. Would you like me to send that to priya.mehta@example.com?",
      pendingAction: "Customer needs to confirm email to generate prepaid return label."
    }
  },
  {
    id: "cust_kabir",
    name: "Kabir Verma",
    email: "kabir.verma@example.com",
    avatar: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&q=80",
    order: {
      orderId: "NC1023",
      product: "Wireless Headphones (NovaBass ANC - Matte Black)",
      price: 89.00,
      status: "Delivered",
      purchaseDate: "Nov 3, 2026",
      deliveredDate: "Nov 7, 2026",
      carrier: "DHL Express",
      trackingNumber: "TRK-NC-449102",
      trackingStatus: "Delivered to reception",
      reportedIssue: "Wrong product received - Package contained wired sports earphones instead of NovaBass ANC wireless",
      initialMessage: "I am really annoyed. I ordered the NovaBass Wireless ANC Headphones (NC1023) and today I opened the box and found cheap wired sports earphones inside! Please fix this immediately."
    },
    ticket: {
      id: "tkt_1023",
      orderId: "NC1023",
      category: "Wrong Product",
      priority: "Critical",
      sentiment: "Negative",
      status: "Human Assistance Requested",
      lastUpdated: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 mins ago
      humanRequested: true,
      summary: "Wrong item delivered for order NC1023. Customer ordered NovaBass ANC Wireless Headphones ($89.00) but received wired earphones. Highly dissatisfied, demanding instant resolution.",
      suggestedReply: "Hi Kabir, I am so sorry for this mix-up with order #NC1023. You should have received the NovaBass Wireless ANC Headphones, and receiving the wrong item is unacceptable. Under our incorrect product policy, we will expedite the correct wireless headphones to you at zero additional cost. To trigger the immediate replacement order and complimentary return label, could you please share a quick photo of the item and box barcode you received?",
      pendingAction: "Customer needs to supply photo verification of wrong item to expedite replacement."
    }
  }
];

export const DEMO_AGENT = {
  id: "agent_sarah",
  name: "Sarah Lin",
  email: "sarah.lin@novacart.demo",
  avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
  role: "Senior Support Specialist",
  department: "Customer Experience & Resolution"
};

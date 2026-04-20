module.exports = {
  // ===========================================
  // AD NETWORK CONFIGURATION
  // ===========================================
  
  // Choose your ad network: 'adsense', 'propellerads', 'adsterra', 'custom'
  AD_NETWORK: 'adsense',
  
  // Google AdSense Configuration
  ADSENSE: {
    PUBLISHER_ID: 'ca-pub-XXXXXXXXXXXXXXXX', // Replace with your AdSense publisher ID
    AD_SLOT: 'XXXXXXXXXX', // Replace with your ad slot ID
  },
  
  // PropellerAds Configuration
  PROPELLERADS: {
    INTEGRATION_ID: 'YOUR_INTEGRATION_ID',
    PLACEMENT_ID: 'YOUR_PLACEMENT_ID',
  },
  
  // Adsterra Configuration
  ADSTERRA: {
    INTEGRATION_ID: 'YOUR_INTEGRATION_ID',
  },
  
  // Custom ad code (HTML/JavaScript)
  CUSTOM_AD_CODE: `
    <!-- Paste your custom ad network code here -->
    <div style="text-align: center; padding: 20px;">
      <h3>Your Custom Ad</h3>
      <p>Replace this with your ad network code</p>
    </div>
  `,
  
  // ===========================================
  // COUNTDOWN SETTINGS
  // ===========================================
  
  // How many seconds to show the ad before allowing skip
  AD_DISPLAY_SECONDS: 5,
  
  // Show skip button after these seconds (set to 0 to disable skip)
  SKIP_BUTTON_AFTER_SECONDS: 3,
  
  // Auto-redirect after countdown (true/false)
  AUTO_REDIRECT: false,
  
  // ===========================================
  // REVENUE SHARE (if implementing user accounts)
  // ===========================================
  
  // Percentage of revenue to share with users (0-100)
  USER_REVENUE_SHARE: 0, // Set to 70 for 70% revenue share
  
  // Minimum payout threshold in USD
  MINIMUM_PAYOUT: 10,
  
  // ===========================================
  // BRANDING
  // ===========================================
  
  SITE_NAME: 'LinkPulse',
  SITE_DESCRIPTION: 'Shorten links, share them, and earn money from every click!',
  PRIMARY_COLOR: '#667eea',
  SECONDARY_COLOR: '#764ba2',
  
  // ===========================================
  // ANALYTICS
  // ===========================================
  
  // Enable detailed click tracking
  ENABLE_CLICK_TRACKING: true,
  
  // Track IP addresses (disable for GDPR compliance)
  TRACK_IP_ADDRESSES: true,
  
  // Track user agents
  TRACK_USER_AGENTS: true,
  
  // Track referrers
  TRACK_REFERRERS: true,
  
  // ===========================================
  // SECURITY
  // ===========================================
  
  // Rate limiting: max requests per minute per IP
  RATE_LIMIT_PER_MINUTE: 60,
  
  // Block known bot user agents
  BLOCK_BOTS: true,
  
  // Allowed domains for CORS (empty array = allow all)
  ALLOWED_ORIGINS: [],
  
  // ===========================================
  // DATABASE
  // ===========================================
  
  // Database file path
  DATABASE_PATH: './links.db',
  
  // ===========================================
  // SERVER
  // ===========================================
  
  // Server port
  PORT: process.env.PORT || 3000,
  
  // Node environment
  NODE_ENV: process.env.NODE_ENV || 'development',
};

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CLIENT_NAMES = [
  'Therese Kamga',
  'Michel Foko',
  'Aurelie Djene',
  'Nadege Song',
  'Pierre Wome'
];

const PROVIDER_UPDATES = [
  { profileId: '67a25ba8-fa01-4929-8889-6d697454e46a', newName: 'Jean-Pierre Tchakounte' },
  { profileId: 'a595c73f-4738-427c-aca5-02ec2c231114', newName: 'Solange Ngo Nemb' },
  { profileId: '0813f012-7914-4128-9134-3f6b8adc629a', newName: 'Emmanuel Ekedi' },
  { profileId: '2e7aed7d-57b5-4447-a752-20f1963bf5aa', newName: 'Dieudonne Ndip' },
  { profileId: '14d5ecd8-da26-43fc-a208-4fc9b4bf53a7', newName: 'Marc Mbarga' },
  { profileId: 'b02b5e9b-8b33-438c-ab6f-f8a0f61498cd', newName: 'Beatrice Ndome' },
  { profileId: '7404cbd1-b1a4-40b8-b5ac-217b0500de9f', newName: 'Alain Nguema' },
  { profileId: 'e614c0f2-4b7d-4a92-8932-6e946694c959', newName: 'Carine Mengue' },
  { profileId: 'f8d91e6b-0ade-4e84-bb75-3376a9fd18e2', newName: 'Charles Atangana' },
  { profileId: 'abb25474-4442-47cb-b381-8e02ce5b05f7', newName: 'Jacqueline Nnanga' }
];

const DUMMY_JOBS = [
  // 7 LOCAL JOBS (DOUALA)
  {
    category: 'Plumbing',
    title: 'Fixing Leaking Kitchen Pipes and Faucet',
    description: 'Our kitchen sink has been leaking from the main drain pipe underneath for a few days, causing water to pool in the cabinet. We also need to replace the old faucet with a new one that we have already purchased. Looking for an experienced plumber to fix the leak, install the new faucet, and ensure everything is properly sealed.',
    location: 'Douala, Akwa (near Orange office)',
    latitude: 4.0483,
    longitude: 9.7042,
    budget: 15000,
    budgetMin: 12000,
    budgetMax: 18000,
    providersNeeded: 1,
    isRemote: false,
    importantDetails: 'Please bring all necessary plumbing tools (wrenches, thread seal tape, etc.). We already have the new faucet and replacement PVC pipes.',
    whatNeedsDone: '- Inspect the source of the leak under the kitchen sink.\n- Replace damaged section of the PVC drain pipe.\n- Uninstall the old faucet and install the new single-lever mixer faucet.\n- Test connections under pressure for any leaks.',
    taskScope: 'Medium repair job, expected to take 1-2 hours.',
    preferences: ['Experienced', 'Bilingual', 'Has own tools'],
    priority: 'high',
    postedDaysAgo: 3,
    postedHour: 9
  },
  {
    category: 'Electrician',
    title: 'Installation of New Distribution Board & LED Lights',
    description: 'We are renovating our living room and need an electrician to replace our old fuse box with a modern distribution board (consumer unit) with circuit breakers. Additionally, we need to install 6 new recessed LED ceiling lights and replace 3 wall switches. All materials (LED lights, switches, and distribution board) are on site.',
    location: 'Douala, Bonapriso (Rue Tokoto)',
    latitude: 4.0298,
    longitude: 9.6994,
    budget: 35000,
    budgetMin: 30000,
    budgetMax: 40000,
    providersNeeded: 1,
    isRemote: false,
    importantDetails: 'Must be a certified electrician. Power must be safely disconnected before starting the work. Work should be completed during daylight hours.',
    whatNeedsDone: '- Safely disconnect and remove the old fuse box.\n- Install and wire the new distribution board with proper grounding.\n- Cut ceiling holes (if needed) and install 6 recessed LED lights.\n- Replace 3 wall switches and test the entire circuit.',
    taskScope: 'Major electrical wiring and installation, approx 4-5 hours.',
    preferences: ['Certified Electrician', 'Detail-oriented', 'Safety first'],
    priority: 'normal',
    postedDaysAgo: 3,
    postedHour: 14
  },
  {
    category: 'Carpenter',
    title: 'Repairing Wooden Wardrobe Doors and Drawer Rails',
    description: 'Our master bedroom wooden wardrobe has two doors that do not close properly because the hinges have come loose. Also, two of the drawers have broken wooden runner rails and keep getting stuck. We need a carpenter to replace the hinges, repair the drawer tracks, and adjust the doors so they align perfectly.',
    location: 'Douala, Deido (near Ecole Publique)',
    latitude: 4.0621,
    longitude: 9.7125,
    budget: 20000,
    budgetMin: 15000,
    budgetMax: 25000,
    providersNeeded: 1,
    isRemote: false,
    importantDetails: 'You will need to supply the replacement hinges and wooden runner strips. We will pay for materials separately if you show the receipt, or you can include them in your bid.',
    whatNeedsDone: '- Remove broken hinges from two wardrobe doors.\n- Fill worn-out screw holes and install new heavy-duty hinges.\n- Re-align and mount wardrobe doors.\n- Remove broken drawer rails and install new smooth wooden/metal tracks.',
    taskScope: 'Minor woodwork repair, expected to take 2-3 hours.',
    preferences: ['Punctual', 'Experienced with wardrobe fittings'],
    priority: 'normal',
    postedDaysAgo: 3,
    postedHour: 17
  },
  {
    category: 'Mason',
    title: 'Concrete Wall Plastering and Retaining Wall Repair',
    description: 'A portion of our outer concrete brick fence wall (approx 10 square meters) has cracked plastering that is peeling off due to rain. We need a mason to scrape off the outer loose plaster, prepare the surface, apply a fresh coat of cement plaster, and smooth it out. We also have a minor crack in the concrete base that needs filling.',
    location: 'Douala, Kotto (near Kotto Block)',
    latitude: 4.0845,
    longitude: 9.7562,
    budget: 45000,
    budgetMin: 40000,
    budgetMax: 50000,
    providersNeeded: 2,
    isRemote: false,
    importantDetails: 'We will provide the cement and sand. The mason must bring their own plastering tools, mixing boards, and trowels.',
    whatNeedsDone: '- Chip away all loose plaster and clean the concrete wall surface.\n- Prepare cement-sand mortar mix.\n- Apply plaster coat evenly across the 10 sqm wall area.\n- Render the surface smooth and repair base cracks.',
    taskScope: 'Outdoor brick and plaster restoration, 1-2 days of work.',
    preferences: ['Experienced Mason', 'Good communication', 'Hardworking'],
    priority: 'normal',
    postedDaysAgo: 3,
    postedHour: 11
  },
  {
    category: 'Painter',
    title: 'Painting 3-Bedroom Apartment Interior & Ceiling',
    description: 'We are looking for a professional painter to paint the walls and ceilings of a 3-bedroom apartment. The walls currently have some dirt marks and minor scratches, so they will need light sanding and prep work before painting. We want 2 coats of paint (acrylic washable paint) for the walls and white emulsion for the ceiling.',
    location: 'Douala, Bonamoussadi (near Super U)',
    latitude: 4.0732,
    longitude: 9.7411,
    budget: 80000,
    budgetMin: 70000,
    budgetMax: 90000,
    providersNeeded: 2,
    isRemote: false,
    importantDetails: 'We will purchase all the paint of our choice. The painter must bring rollers, brushes, masking tape, protective sheets, and ladders.',
    whatNeedsDone: '- Move furniture to the center and cover with protective sheets.\n- Sand down walls and apply primer or filler where needed.\n- Paint ceilings with two coats of white emulsion.\n- Paint walls with two coats of client-provided color acrylic paint.',
    taskScope: 'Full apartment interior painting, estimated 2 days.',
    preferences: ['Neat and tidy', 'Trustworthy', 'Experienced team'],
    priority: 'normal',
    postedDaysAgo: 2,
    postedHour: 8
  },
  {
    category: 'House Cleaning',
    title: 'Deep Cleaning of 2-Bedroom Apartment After Moving Out',
    description: 'We have just moved out of a 2-bedroom apartment and need to hand it over to the landlord clean. The apartment requires deep cleaning, including scrubbing the tiled floors, cleaning inside all kitchen cabinets, washing the bathrooms/toilets thoroughly, cleaning the windows, and wiping down all doors.',
    location: 'Douala, Logpom (near Carrefour Logpom)',
    latitude: 4.0801,
    longitude: 9.7645,
    budget: 25000,
    budgetMin: 20000,
    budgetMax: 30000,
    providersNeeded: 2,
    isRemote: false,
    importantDetails: 'The apartment is empty of furniture. Cleaner should bring all cleaning detergents, scrubs, mops, and buckets.',
    whatNeedsDone: '- Thoroughly scrub tiled floors in living room, bedrooms, and kitchen.\n- Wash and sanitize toilet bowls, sinks, wall tiles, and shower area.\n- Wipe down internal and external surfaces of all kitchen cabinets.\n- Clean windows (glass and frames) and wipe down doors.',
    taskScope: 'Deep empty apartment cleaning, approx 4-5 hours.',
    preferences: ['Thorough cleaners', 'Punctual', 'Bring own detergents'],
    priority: 'high',
    postedDaysAgo: 2,
    postedHour: 10
  },
  {
    category: 'Gardening',
    title: 'Lawn Mowing, Tree Pruning, and Flower Garden Maintenance',
    description: "Our compound's lawn has grown very high and we need it mown. We also have several ornamental shrubs and a palm tree that need pruning and shaping. Lastly, the flower beds need weeding and general clean up. Looking for a gardener with their own lawn mower and shears to do a clean job.",
    location: 'Douala, Bali (near Douala Club)',
    latitude: 4.0375,
    longitude: 9.6891,
    budget: 18000,
    budgetMin: 15000,
    budgetMax: 20000,
    providersNeeded: 1,
    isRemote: false,
    importantDetails: 'You must bring your own lawn mower (petrol-powered preferred as we don\'t have a long extension cord) and pruning shears.',
    whatNeedsDone: '- Mow the lawn across the front and back yard.\n- Weed the flower beds and clear dried leaves.\n- Trim and prune hedges, shrubs, and low palm branches.\n- Bag and dispose of all garden waste in the designated bin.',
    taskScope: 'Compound gardening and landscaping maintenance, 3-4 hours.',
    preferences: ['Experienced gardener', 'Has lawn mower', 'Reliable'],
    priority: 'normal',
    postedDaysAgo: 2,
    postedHour: 15
  },

  // 8 REMOTE JOBS
  {
    category: 'Web Development',
    title: 'Build a Multi-vendor E-commerce Website with React/Node.js',
    description: 'We are starting a local online marketplace in Cameroon and need a senior fullstack developer to build a responsive multi-vendor e-commerce platform. Vendors should be able to create stores, list products, and manage orders. Customers should have a cart, payment gateway integration (Mobile Money via API), and tracking. We require React for the frontend and Node.js/Express with Postgres for the backend.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 600000,
    budgetMin: 500000,
    budgetMax: 700000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Project milestones will be set. Code must be well-documented and hosted on GitHub. Developer must be available for weekly progress syncs via Zoom.',
    whatNeedsDone: '- Design database schema and implement Node.js API server.\n- Build responsive React web frontend (admin, vendor, customer panels).\n- Integrate MTN Mobile Money & Orange Money payment APIs.\n- Deploy the application to a VPS (e.g., DigitalOcean) with SSL.',
    taskScope: 'Large scale fullstack web application, estimated 1 month duration.',
    preferences: ['Senior developer', 'Experience with payment integration', 'Good communication'],
    priority: 'normal',
    postedDaysAgo: 2,
    postedHour: 18
  },
  {
    category: 'Graphic Design',
    title: 'Create Brand Logo, Stationery, and Social Media Kit',
    description: 'We are launching a new organic skincare brand and need a modern, clean, and elegant visual identity. We need a primary logo, secondary logo, color palette, typography guidelines, business card design, letterhead design, and 6 Instagram post templates in Canva or Figma. The style should feel natural, premium, and minimalistic.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 40000,
    budgetMin: 35000,
    budgetMax: 50000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Please share your portfolio with branding and logo designs when bidding. Deliverables must include vector files (AI, EPS, SVG) and PNG/JPG formats.',
    whatNeedsDone: '- Conceptualize and design 3 unique logo concepts.\n- Refine chosen concept based on feedback (up to 3 revisions).\n- Design business card layout, letterhead, and brand color palette document.\n- Create 6 editable social media templates in Figma/Canva.',
    taskScope: 'Brand identity design package, 5-7 days.',
    preferences: ['Creative designer', 'Minimalist style', 'Fast delivery'],
    priority: 'normal',
    postedDaysAgo: 2,
    postedHour: 11
  },
  {
    category: 'Translation',
    title: 'Translate Legal Business Contract from English to French',
    description: 'We need a professional translator to translate a 15-page partnership agreement contract from English to French. The contract contains standard legal terminology, terms of services, and liability clauses. The translated text must be legally accurate, clear, and formatted identically to the original Word document.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 30000,
    budgetMin: 25000,
    budgetMax: 35000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Must have experience translating legal documents. Professional translation only, no machine translations (Google Translate/DeepL) will be accepted without careful editing.',
    whatNeedsDone: '- Translate 15 pages of legal contract text from English to French.\n- Proofread and edit for legal accuracy, grammar, and style.\n- Align formatting, tables, and sections with the source English document.',
    taskScope: 'Legal document translation, approx 4,000 words, 3 days.',
    preferences: ['Legal translator', 'Detail-oriented', 'Excellent French grammar'],
    priority: 'normal',
    postedDaysAgo: 1,
    postedHour: 9
  },
  {
    category: 'Writing',
    title: 'Write 5 SEO-optimized Blog Articles for a Real Estate Website',
    description: 'We need an engaging content writer to write 5 blog posts for our property portal. The articles should focus on the real estate market in Cameroon, tips for buying land, and renting advice. Each article must be between 1000 - 1200 words, containing relevant keywords (which we will provide), meta descriptions, and clear subheadings (H2, H3).',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 25000,
    budgetMin: 20000,
    budgetMax: 30000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Articles must be 100% unique (plagiarism-free) and written in an informative, professional tone. AI-generated text from ChatGPT is not allowed unless heavily edited to sound human.',
    whatNeedsDone: '- Research and draft 5 articles based on provided outlines.\n- Integrate SEO keywords naturally throughout the text.\n- Write catching titles and meta descriptions for each article.\n- Revise content based on feedback (up to 2 rounds).',
    taskScope: 'Content writing project, 5 articles, 4 days.',
    preferences: ['SEO content writer', 'Excellent English/French writing', 'Original content'],
    priority: 'normal',
    postedDaysAgo: 1,
    postedHour: 13
  },
  {
    category: 'Virtual Assistant',
    title: 'Manage Customer Emails, Appointments, and Schedule Meetings',
    description: 'We are a busy consulting agency looking for a reliable remote virtual assistant for 10 hours a week. Your role will involve checking our general inbox twice a day, responding to standard inquiries, scheduling consultation appointments in Google Calendar, and sending out Zoom reminders to clients. Must be highly organized and responsive.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 50000,
    budgetMin: 45000,
    budgetMax: 55000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'This is a part-time position (2 hours a day, Monday to Friday). Good internet connection and quiet working environment are required.',
    whatNeedsDone: '- Monitor primary email inbox and respond to user queries.\n- Book meetings and manage calendar invites in Google Calendar.\n- Draft weekly summary reports of clients scheduled and emails processed.',
    taskScope: 'Ongoing weekly virtual assistance, 1 week trial.',
    preferences: ['Highly organized', 'Polite tone', 'Proficient in Google Workspace'],
    priority: 'normal',
    postedDaysAgo: 1,
    postedHour: 15
  },
  {
    category: 'Digital Marketing',
    title: 'Set Up and Manage Facebook & Instagram Ads Campaign',
    description: 'We are launching a new online fashion boutique and need a digital marketer to set up our Meta Ads Manager account, create ad campaigns targeting young adults in Douala and Yaoundé, write ad copies, and manage the ads for 2 weeks. The goal is to drive traffic to our WhatsApp catalog and increase sales. Budget for the ads themselves will be provided separately.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 60000,
    budgetMin: 50000,
    budgetMax: 70000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Must have a track record of setting up profitable Meta Ads campaigns. Please share screenshot of past campaign metrics (ROAS, CPC) if possible.',
    whatNeedsDone: '- Configure Meta Pixel and set up Ads Manager.\n- Design 3 ad copy variations and suggest creatives.\n- Define target audience demographics and set up A/B testing.\n- Monitor ad performance daily, optimize bids, and provide a 2-week report.',
    taskScope: 'Ad campaign setup and 2-week active management.',
    preferences: ['Meta Ads expert', 'Data-driven marketer', 'ROAS focused'],
    priority: 'normal',
    postedDaysAgo: 1,
    postedHour: 17
  },
  {
    category: 'Data Entry',
    title: 'Extract Data from PDF Invoices and Organize in Excel Sheet',
    description: 'We have a batch of 350 scanned PDF invoices from last quarter. We need a detail-oriented freelancer to manually extract specific data fields: Invoice Number, Date, Vendor Name, Total Amount, and VAT, and type them into an Excel spreadsheet that we will provide. Accuracy is critical, as these figures are used for accounting.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 15000,
    budgetMin: 12000,
    budgetMax: 18000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Data must be double-checked for typos. High speed and precision are required.',
    whatNeedsDone: '- Open each of the 350 PDF invoice documents.\n- Locate key fields (Number, Date, Vendor, Amount, VAT).\n- Correctly enter the data into the designated Excel template.\n- Verify all total sums match original invoices.',
    taskScope: 'Repetitive data entry task, approx 8-10 hours of work, 2 days.',
    preferences: ['Accurate', 'Fast typer', 'Excel proficient'],
    priority: 'normal',
    postedDaysAgo: 1,
    postedHour: 10
  },
  {
    category: 'IT Support',
    title: 'Configure Remote VPN, Email Server, and Office 365',
    description: 'Our small business (12 employees) is moving to a hybrid work model. We need an IT systems administrator to configure a secure OpenVPN server on our host, set up custom business email addresses using Google Workspace or Microsoft Office 365, and set up basic access permission folders on cloud storage. We need this set up securely and quickly.',
    location: 'Remote',
    latitude: null,
    longitude: null,
    budget: 80000,
    budgetMin: 70000,
    budgetMax: 90000,
    providersNeeded: 1,
    isRemote: true,
    importantDetails: 'Credentials will be shared securely via a password manager. Must sign a non-disclosure agreement before starting.',
    whatNeedsDone: '- Install and configure OpenVPN server on our Linux VPS.\n- Set up Google Workspace tenant, verify domain, and create 12 user accounts.\n- Configure DNS records (MX, SPF, DKIM, DMARC) for email deliverability.\n- Set up shared folders in Google Drive with permission levels.',
    taskScope: 'IT infrastructure setup, approx 6-8 hours.',
    preferences: ['Systems Administrator', 'Network security focused', 'Clear instructions'],
    priority: 'high',
    postedDaysAgo: 1,
    postedHour: 11
  }
];

async function seed() {
  console.log('Seeding distinct Cameroonian names for CLIENTS and PROVIDERS...');
  try {
    // 1. Rename existing PROVIDER users in the database
    for (const update of PROVIDER_UPDATES) {
      const profile = await prisma.providerProfile.findUnique({
        where: { id: update.profileId },
        select: { userId: true }
      });
      if (profile && profile.userId) {
        await prisma.user.update({
          where: { id: profile.userId },
          data: { fullName: update.newName }
        });
        console.log(`Renamed Provider Profile ${update.profileId} user to: ${update.newName}`);
      }
    }

    // 2. Fetch/update CLIENT users
    let clients = await prisma.user.findMany({
      where: { role: 'CLIENT' },
      take: CLIENT_NAMES.length
    });

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const newName = CLIENT_NAMES[i % CLIENT_NAMES.length];
      await prisma.user.update({
        where: { id: client.id },
        data: { fullName: newName }
      });
      console.log(`Renamed Client ${client.id} to: ${newName}`);
    }

    clients = await prisma.user.findMany({
      where: { role: 'CLIENT' }
    });

    // 3. Delete previous job assignments and jobs to avoid foreign key errors
    await prisma.jobAssignment.deleteMany({});
    const deleteRes = await prisma.job.deleteMany({});
    console.log(`Deleted ${deleteRes.count} old jobs before recreating.`);

    // 4. Create the 15 jobs again
    for (let i = 0; i < DUMMY_JOBS.length; i++) {
      const jobData = DUMMY_JOBS[i];
      const client = clients[i % clients.length];

      const date = new Date('2026-07-30T10:00:00.000Z');
      date.setDate(date.getDate() - jobData.postedDaysAgo);
      date.setHours(jobData.postedHour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));

      const scheduledDate = new Date(date);
      scheduledDate.setDate(scheduledDate.getDate() + 3 + Math.floor(Math.random() * 5));

      const createdJob = await prisma.job.create({
        data: {
          clientId: client.id,
          category: jobData.category,
          title: jobData.title,
          description: jobData.description,
          location: jobData.location,
          latitude: jobData.latitude,
          longitude: jobData.longitude,
          budget: jobData.budget,
          budgetMin: jobData.budgetMin,
          budgetMax: jobData.budgetMax,
          status: 'PENDING',
          approvalStatus: 'APPROVED',
          providersNeeded: jobData.providersNeeded,
          coinCost: 1,
          scheduledTime: scheduledDate,
          isRemote: jobData.isRemote,
          country: 'Cameroon',
          importantDetails: jobData.importantDetails,
          whatNeedsDone: jobData.whatNeedsDone,
          taskScope: jobData.taskScope,
          preferences: jobData.preferences,
          priority: jobData.priority
        }
      });

      await prisma.$executeRaw`
        UPDATE "Job"
        SET "createdAt" = ${date}, "updatedAt" = ${date}
        WHERE "id" = ${createdJob.id}
      `;

      console.log(`[${i+1}/15] Recreated job: "${jobData.title}" under category "${jobData.category}"`);
      console.log(`       Client: ${client.fullName}, Posted on: ${date.toISOString()}`);
    }

    console.log('Successfully completed seeding with Cameroon names!');
  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

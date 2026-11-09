# 04 · The 30-video plan

**Window:** Mon 16 Nov to Tue 15 Dec 2026, one video a day. **Week 0 (10–15 Nov)** is for building
Elo and producing a bank of the first 7 videos before anything goes live.

It covers three real calendar moments: leftover Diwali mithai, Indian wedding season (peak Nov–Dec),
and US Thanksgiving (Thu 26 Nov). It ends by setting up January, the biggest month of the year for
fitness-app installs, so "start in December" is the closing angle.

### How to read this plan

- **30 productions become about 45 posts.** Each video is tagged:
  - 🇮🇳 **IN**: Hinglish, Indian food. Posts on the India account (Instagram + YouTube Shorts).
  - 🇺🇸 **US**: English, US food. Posts on the US/global account (TikTok + Instagram + YouTube Shorts).
  - 🌍 **BOTH**: universal topic. Same visuals with two voice tracks (Elo-HI and Elo-EN), posted on both accounts.
  - Totals: 14 IN + 2 US + 14 BOTH. The India account gets 28 posts and the US account 16.
- **Numbers on screen** come from Elovia's own food database (`artifacts/mobile/utils/foodDatabase.ts`),
  so they match what the app shows. **Before publishing, look the item up or scan it in the app and
  use whatever the app actually shows.** Always show "~" (approx.) and **the portion** on calorie cards,
  for example "1 large piece". Published calorie counts for Indian food vary widely by size and
  recipe; a samosa, for instance, is quoted anywhere from about 130 to 260 kcal depending on the source.
- **Free vs Pro.** In the current code the **AI food-photo scan is a Pro feature** (`ai_food_scan`;
  free accounts get 0 AI scans a day, and the trial gets a limited number). **Food search, barcode
  scanning and manual logging are free.** Elo's fictional scan can appear in any video. But when you
  screen-record the *real* photo scan, use a Pro or trial account, and never caption or say "scan
  your food for free".
- **Hook** = what happens in the first 1–2 seconds: picture + line + on-screen text, all at once.
- Lines are written in Hinglish for IN videos, with English below in brackets for the dub or for whoever
  edits the captions.
- Every video ends on a **loop point**, so the last frame flows back into the first.

### The series (recurring formats; viewers should learn to recognise them)

| Series | Mechanic | Main share trigger | Count |
|---|---|---|---|
| **Scan It First** | Food sneaks onto your plate, Elo scans it, number, swap | Practical value + "this is so me" | 4 |
| **Guess the Calories** | Two foods, guess in the comments, reveal | Comments + debate | 4 |
| **Food Gang** | Comedy with the villain foods | Humour + tag a friend | 2 (+ cameos everywhere) |
| **Body Squad** | Your body parts react to your habits | Gym humour + tag your gym buddy | 3 |
| **2AM Club** | Night cravings, horror-parody lighting | Late-night relatability | 2 |
| **Myth Busted** | Elo debunks a food myth with one number | Practical value + argument in the comments | 5 |
| **Wedding Season** | Multi-part survival guide | Saves + follow for part 2 | 3 |
| **You Asked, Elo Scanned** | Replies to commented foods with rapid scans | Viewers see their own comment on screen | 3 |
| **Specials** | Meet Elo, Thanksgiving, founder behind-the-scenes, finale, recap | Trust + context | 4 |

---

## Week 1 · Introduce Elo and the Scan

### Day 1 · Mon 16 Nov · Scan It First #1: "The Samosa Ambush" 🇮🇳 · 20s
- **Hook:** An office chai break. A hand reaches for a samosa. Elo **leaps out of the phone** and lands on it. *"RUKO."* On screen: **"POV: your phone has trust issues"**
- **Beats:**
  1. Samosa Bhai (sunglasses): *"Ek hi toh hai, boss."* ("It's just one, boss.")
  2. Elo: *"Pehle scan."* Scan: zzt-ding. Card: **Samosa · 1 large piece · ~260 kcal**
  3. Elo: *"Do-sau-saath. Ek. Piece."* Samosa: *"…aur chai ke saath?"* The wristband ticks up +80 to **340**. Elo faints.
  4. Elo sits back up: *"Theek hai. Half. HALF. Aur log kar."* ("Fine. Half. HALF. And log it.") The hand breaks the samosa in two.
- **App moment (1.5s):** Real screen recording: the Elovia food log with "Samosa ×0.5" added.
- **Loop:** Samosa Bhai whispers *"Kal milte hain…"* ("See you tomorrow…"), which cuts back to the hand reaching.
- **Caption:** "Tag the colleague who always says 'bas ek' 🥟"
- **Why it should work:** a daily ritual every Indian office worker recognises, plus a number reveal (practical value), plus a tag-a-friend trigger.

### Day 2 · Tue 17 Nov · Body Squad #1: "Your liver after Diwali week" 🇮🇳 · 25s
- **Hook:** Your Liver at a desk buried under files labelled MITHAI, NAMKEEN and LATE NIGHTS. On the phone: *"Haan ji, complaint file karni hai."* ("Yes, I'd like to file a complaint.") On screen: **"Your liver, one week after Diwali"**
- **Beats:**
  1. Elo pops up as a tiny customer-care agent with a headset.
  2. Liver reads out the list. Elo scans the leftover gift box: **2 barfi ~180 · 1 besan ladoo ~160 · gajar halwa ~250**
  3. Liver: *"Ab detox juice bhejo."* ("Now send me a detox juice.") Elo: *"Detox juice nahi. Normal khana, paani, neend. Tu khud detox hai."* ("No detox juice. Normal food, water, sleep. You ARE the detox.")
- **App moment:** Hydration tracker filling up, then today's plan card.
- **Loop:** Liver drops the phone and a new file lands: "GULAB JAMUN (gift)".
- **Caption:** "Who still has a mithai box in the fridge? 🙋"
- **Guardrail:** no detox claims, no medical claims. The joke rejects the detox idea.

### Day 3 · Wed 18 Nov · Special: "Meet Elo" 🌍 · 20s · **Pin this one**
- **Hook:** Dark room. A phone on the table glows and its screen cracks with blue light. Elo climbs out: *"Hi. I've seen your 2AM orders."* On screen: **"There's an AI living in your phone. It's judging your plate."**
- **Beats:**
  1. *"I'm Elo. I live inside Elovia."* A quick montage from real screen recordings: food scan, workout plan, PR confetti.
  2. *"I scan your food. I plan your workouts. I tell you the truth."*
  3. *"I judge plates. Never people."*
- **Loop:** Elo jumps back into the phone; the screen goes dark. That dark frame is the opening frame.
- **Caption:** "Follow if you want a friend who tells you the truth ⚡"
- **Why:** profile visitors need context. A pinned intro turns a viral visitor into a follower.

### Day 4 · Thu 19 Nov · 2AM Club #1: "Nobody's watching" 🌍 · 20s
- **Hook:** A dark kitchen lit only by the fridge. A bowl of instant noodles whispers *"nobody's watching…"* Two glowing blue eyes open in the dark. **"I'm watching."** (Horror-movie sting.) On screen: **"2:07 AM"**
- **Beats:**
  1. Scan: **Instant noodles · 1 packet · ~380 kcal**
  2. 2AM Noodles: *"But you're SO hungry."* Elo: *"You're bored. Hungry is different."*
  3. The swap: *"Two boiled eggs, ~155. Or Greek yogurt, ~100. Pick one. Go to sleep."*
- **App moment:** Logging Greek yogurt in Elovia (the "repeat recent" row).
- **Loop:** Elo pulls the phone screen over itself like a blanket. *"Elo out."* Back to the dark kitchen.
- **Caption:** "Be honest: what's your 2AM food? 👇" (seeds future "You Asked" episodes)

### Day 5 · Fri 20 Nov · Guess the Calories #1: "1 butter naan vs 3 rotis" 🇮🇳 · 18s
- **Hook:** Elo stands between one shiny butter naan and a stack of three rotis. *"Kisme zyada? Teen second."* ("Which has more? Three seconds.") On screen: **"1 butter naan vs 3 rotis. Guess 👇"** A ticking countdown.
- **Beats:**
  1. Butter Naan flexes: *"I'm basically protein, bro."*
  2. Reveal: **Butter naan ~317** vs **3 rotis ~312**. *"Same."*
  3. Elo: *"Ek naan = teen roti. Plate pe zyada khana chahiye? Roti."* ("One naan equals three rotis. Want more food on the plate? Rotis.")
- **App moment:** Elovia food search with both items side by side.
- **Loop:** Butter Naan, sulking: *"Rematch."* Cut to the countdown.
- **Caption:** "Comment the next battle 🥊"

### Day 6 · Sat 21 Nov · Body Squad #2: "Your glutes on leg day" 🌍 · 22s
- **Hook:** Two sleepy pillow-glutes snoring in eye masks. An alarm reads **LEG DAY**. Glutes: *"…who scheduled this?"* On screen: **"Your glutes when you finally do squats"**
- **Beats:**
  1. Elo in a coach whistle. Squats, with the Glutes groaning in sync.
  2. Glutes: *"We've been asleep since 2019."* Elo: *"Exactly."*
  3. Last set: real Elovia screen with **PR confetti**.
- **Loop:** Glutes: *"…that was kinda nice."* Elo: *"See you Thursday."* Glutes faint back to sleep.
- **Caption:** "Send this to your gym partner who skips legs 🍑"
- **App moment:** Workout logging screen, then the personal-record celebration (a real shipped feature).

### Day 7 · Sun 22 Nov · Wedding Season Pt 1: "The Jamun Twins' buffet heist" 🇮🇳 · 28s
- **Hook:** A wedding buffet under marigold lights. The Jamun Twins slide down a syrup slide onto your plate: *"Hum toh sirf 175 hain. Dono milake."* ("We're only 175. Combined.") On screen: **"Wedding season survival guide, part 1"**
- **Beats:**
  1. Elo, wearing a tiny marigold garland, scans the whole plate: **Paneer butter masala ~320 · Butter naan ~317 · Veg biryani ~290 · 2 gulab jamun ~175**
  2. Total **~1,102**. Elo faints in slow motion into the raita.
  3. Recovery: *"Shaadi hai, enjoy kar. Bas: ek naan, aadhi biryani, jamun share kar."* ("It's a wedding, enjoy it. Just: one naan, half the biryani, share the jamuns.") Rebuilt plate: **~600**.
- **App moment:** Elovia daily total, then "Log meal".
- **Loop:** The Twins whisper *"Part 2…"* and slide away.
- **Caption:** "How many weddings do you have this season? 💍 Part 2 next Sunday."

---

## Week 2 · Grow the cast and get people commenting

### Day 8 · Mon 23 Nov · Myth Busted #1: "Gur wali chai is healthy, right?" 🇮🇳 · 18s
- **Hook:** Elo holds a cube of jaggery like evidence. *"Gur healthy hai… right?"* On screen: **"Jaggery vs sugar: the calorie truth"**
- **Beats:**
  1. Two cards: **Jaggery ~383 kcal/100g** vs **Sugar ~387 kcal/100g**
  2. Elo: *"Calories? Almost same. Chai mein meetha meetha hai."* ("Calories? Almost the same. Sweet is sweet in your chai.")
  3. *"Pasand hai toh pi. Bas count kar."* ("If you like it, drink it. Just count it.")
- **App moment:** Logging a chai with a custom sweetener amount.
- **Caption:** "Team gur or team chini? 👇"
- **Guardrail:** this video is only about calories. Don't make micronutrient claims either way.

### Day 9 · Tue 24 Nov · Scan It First #2: "Which bar is lying?" 🌍 · 20s
- **Hook:** Two snack bars wearing **HEALTHY** sashes, posing like pageant contestants. Elo: *"One of you is lying."* On screen: **"Protein bar vs granola bar"**
- **Beats:**
  1. Scan the protein bar: **~210 kcal · 20g protein**. Elo: *"Okay. Respect."*
  2. Scan the granola bar: **~190 kcal · 3g protein**. The granola bar sweats.
  3. Elo: *"Same calories. Read the protein, not the packaging."*
- **App moment:** Barcode scan in Elovia (a real feature) adding the bar.
- **Loop:** The granola bar quietly takes off its sash. Cut to the pageant.
- **Caption:** "What's in your bag right now? 🎒"

### Day 10 · Wed 25 Nov · Special: "Thanksgiving plate check" 🇺🇸 · 25s
- **Hook:** A slice of Holiday Pie in a tiny cardigan: *"Your aunt made me. You're not going to eat me?"* On screen: **"Thanksgiving without the food coma"**
- **Beats:**
  1. Elo scans the plate: **Turkey breast 100g ~135 · 30g protein**. Elo, sparkling: *"MVP."*
  2. **Mashed potatoes, 1 cup ~210 · Mac & cheese, 1 cup ~380**. The pie scans via AI photo; **use the number the app shows**.
  3. Strategy card: *"Protein first. Sides second. Pie: yes. One slice. Log it."*
- **App moment:** AI food-photo scan of the whole plate.
- **Loop:** The pie whispers *"Seconds?"* Elo: *"…Friday."*
- **Caption:** "Who's carving this year? 🦃"

### Day 11 · Thu 26 Nov · Guess the Calories #2: "6 golgappe vs 1 samosa" 🇮🇳 · 18s
- **Hook:** Pani puri and Samosa Bhai face off like boxers. On screen: **"6 golgappe or 1 samosa: which is lighter?"** A countdown.
- **Beats:**
  1. Samosa Bhai: *"Main toh classic hoon."* ("I'm a classic.")
  2. Reveal: **6 pani puri ~180** vs **1 samosa ~260**. The golgappe celebrate.
  3. Elo: *"Golgappe jeet gaye. Bhaiya, ek aur… nahi. Bas."* ("The golgappe win. Bhaiya, one more… no. Done.")
- **CTA:** *"Apna street food comment kar. Elo next video mein scan karega."* ("Comment your street food. Elo will scan it in the next video.") This sets up Day 15.
- **Caption:** "Comment your city's best street food 👇 Elo scans the top ones."

### Day 12 · Fri 27 Nov · Scan It First #3: "Just one bite" 🌍 · 20s
- **Hook:** A partner's plate of fries. A hand sneaks in: *"I'm not hungry, I'll just have a bite of yours."* Elo appears on the ketchup bottle: *"That's bite number five."* On screen: **"The 'just one bite' person"**
- **Beats:**
  1. Elo counts the bites on its wristband: 1… 2… 3… 4… 5.
  2. Scan: **Medium fries ~365 kcal**. *"You ate a third. That's ~120."*
  3. *"Want fries? Order fries. Log fries. Bites count."*
- **App moment:** Logging "French fries ×0.33" (Elovia supports partial servings).
- **Loop:** The partner slowly pulls the plate away. Cut to the hand sneaking back in.
- **Caption:** "Tag the one who 'isn't hungry' 🍟"
- **Why:** relationship tags are among the strongest share triggers in short-form.

### Day 13 · Sat 28 Nov · Food Gang #1: "Butter Naan, the gym bro" 🇮🇳 · 22s
- **Hook:** Butter Naan in a gym, flexing in the mirror: *"Bro, main basically protein hoon."* ("Bro, I'm basically protein.") On screen: **"When the naan says it's high protein"**
- **Beats:**
  1. Elo scans: **Butter naan ~317 kcal · 9g protein**. Elo: *"Nine."*
  2. Tandoori Chicken walks in: **2 pieces ~195 kcal · 28g protein**. *"THIS is protein, bro."*
  3. Naan, quietly: *"…main bas side character hoon."* ("…I'm just a side character.")
- **App moment:** Elovia macro bars filling up with protein.
- **Loop:** Naan starts flexing again. Cut to the mirror.
- **Caption:** "Send this to your gym bro who orders 3 naans 💪"

### Day 14 · Sun 29 Nov · Wedding Season Pt 2: "Sangeet steps vs jamuns" 🇮🇳 · 22s
- **Hook:** A sangeet dance floor. Elo, in a marigold garland, dances on a dhol while its wristband counts steps. On screen: **"Wedding season survival guide, part 2"**
- **Beats:**
  1. Wristband: **12,000 steps!** Elo celebrates.
  2. The Jamun Twins arrive with friends. The wristband now reads **+4 jamuns ~350**.
  3. Elo: *"Dance kar. Khoob kar. Par dance se jamun 'cancel' nahi hote."* ("Dance. Dance a lot. But dancing doesn't 'cancel out' jamuns.") *"Ek. Share kar."* ("One. Share it.")
- **App moment:** Elovia steps sync (Apple Health / Health Connect) on Home.
- **Loop:** The dhol beat restarts and Elo jumps back on.
- **Caption:** "Which song gets YOU on the dance floor? 🥁 Part 3 next Sunday."

---

## Week 3 · Turn comments into content, add trust

### Day 15 · Mon 30 Nov · You Asked, Elo Scanned #1 🇮🇳 · 25s
- **Hook:** A real comment from Day 11 on screen as a reply sticker. Elo: *"Tumne bola. Maine scan kiya."* ("You asked. I scanned.") On screen: **"Your street food, scanned"**
- **Beats:** Three rapid scans, five seconds each. Use the top-commented foods. Likely picks from the database: **Vada pav ~290 · Pav bhaji ~380 · 6 steamed momos ~210 (12g protein)**
- **Twist:** Momos win, with *"12 gram protein? Momos, you're on the team."*
- **CTA:** *"Next batch? Comment kar."* ("Next batch? Comment.")
- **Why:** people come back to see if their comment was picked. It also feeds the algorithm comment velocity.

### Day 16 · Tue 1 Dec · Myth Busted #2: "Drinks don't count" 🌍 (food swap per market) · 20s
- **Hook:** IN: four cups of chai in a row. US: three lattes. Elo: *"These don't count, right?"* Long pause. On screen: **"Your drinks have calories too"**
- **Beats:**
  1. IN: **Masala chai ~80 × 4 = ~320**, *"= 1 butter naan (~317)."*
  2. US: **Latte 12 oz ~190 × 3 = ~570**, *"= more than a cheeseburger (~520)."*
  3. Elo: *"Keep the drink. Just log the drink."*
- **App moment:** One-tap "repeat" logging of a drink.
- **Production note:** generate two versions of the cups shot; everything else is shared.
- **Caption:** IN "Kitni chai, sach batao ☕" ("How many chais a day? Be honest.") / US "How many coffees deep are you today? ☕"

### Day 17 · Wed 2 Dec · Myth Busted #3: "Veg diet mein protein nahi milta" 🇮🇳 · 25s · **Built to be saved**
- **Hook:** Elo's wristband shows a protein meter at **0g**. A voice off-screen: *"Veg ho? Protein bhool jao."* ("You're veg? Forget about protein.") Elo glares at the camera. On screen: **"Vegetarian protein: the real maths"**
- **Beats:**
  1. Elo scans a typical veg day: **poha ~4.7g · dal tadka ~9g · 4 rotis ~12g**. The meter crawls to about **26g**. Elo: *"Problem mil gaya." ("Found the problem.")*
  2. Three add-ons, each with a *zzt-ding*: **1 cup dahi ~11g · 100g paneer ~18g · 1 bowl chole ~10g**. The meter jumps to about **65g**.
  3. Elo: *"Veg mein protein hai. Bas plan chahiye."* ("There's protein in veg. You just need a plan.")
- **App moment:** Elovia's macro bar for protein, against the user's own target (the app sets it from the profile, so **don't** quote one target for everyone).
- **Loop:** The off-screen voice: *"…aur soya?"* Elo: *"Part 2."*
- **Caption:** "Save this. Send it to the vegetarian who 'can't get protein' 🥛"
- **Why:** Indian audiences engage heavily with vegetarian protein right now (brands and creators are pushing protein everywhere), and a protein day plan is useful enough to save.
- **Guardrail:** don't repeat statistics like "73% of Indians are protein-deficient"; their sourcing is unclear.

### Day 18 · Thu 3 Dec · Guess the Calories #3: "Ramen vs cheeseburger" 🇺🇸 · 18s
- **Hook:** A steaming bowl of ramen vs a cheeseburger. On screen: **"Which one has more calories? Most people get this wrong."** A countdown.
- **Beats:**
  1. Reveal: **Tonkotsu ramen ~550** vs **Cheeseburger ~520**.
  2. The ramen looks shocked. Elo: *"Broth counts."*
  3. *"Both are fine. Just know the number."*
- **Caption:** "Did you guess right? 🍜🍔"

### Day 19 · Fri 4 Dec · 2AM Club #2: "The 1 AM delivery order" 🌍 · 22s
- **Hook:** A phone notification: *"Your order is on the way 🛵"* at 1:12 AM. Elo bursts out of the notification banner: **"CANCEL."** On screen: **"POV: your phone stages an intervention"**
- **Beats:**
  1. The cart shows a generic burger plus fries. Elo scans: **~520 + ~365 = ~885**.
  2. Elo opens the fridge: *"Leftover dal and one roti? ~250. Already paid for."*
  3. You hesitate. Elo, softly: *"Your call. Just log it either way."*
- **Rule:** no real food-delivery app branding. Use a generic notification.
- **Loop:** A new notification arrives: "Your order is on the way…"
- **Caption:** "What time do YOUR cravings hit? 🌙"

### Day 20 · Sat 5 Dec · Special: "We built an AI that judges plates, not people" 🌍 · 30s · **Real founder**
- **Hook:** The founder's real hand puts a phone on the desk. Elo stands next to it. On screen: **"I'm the human behind Elo"**
- **Beats:**
  1. Founder voiceover (real voice, face optional): why Elovia exists, in one sentence. Make it personal and true.
  2. A real demo: scanning a real home-cooked thali with the real app. The number shows.
  3. Be open about AI: *"Elo is animated with AI. The app and the numbers are real."*
- **CTA (pick based on launch status):** live: *"Link in bio. Logging is free; the AI photo scan comes with Pro."* Pre-launch: *"Comment ELO and I'll DM you when it's live."*
- **Why:** trust is the bottleneck for an AI-made channel. Being open about it is a reason to follow, and it protects the brand from any "is this AI?" backlash.

### Day 21 · Sun 6 Dec · Wedding Season Pt 3: "The 20-second buffet strategy" 🇮🇳 · 20s · **Built to be saved**
- **Hook:** Elo stands on the rim of an empty plate at the front of a buffet line. *"20 second. Plan sun."* ("20 seconds. Here's the plan.") On screen: **"Save this before your next shaadi 📌"**
- **Beats:** Elo builds the plate in four fast steps, each with a number:
  1. **Protein first:** tandoori chicken ~195 (28g protein) or paneer tikka
  2. **Sabzi / dal:** dal makhani ~185
  3. **One bread:** roti ~104 (not naan, ~317)
  4. **Dessert:** share one jamun pair, ~88 each for half
- **Total card:** ~570, vs ~1,100 for the Part 1 plate.
- **Loop:** Elo jumps into the buffet line again.
- **Caption:** "Save it. Send it to your shaadi group chat. 💍 (Series finale.)"

---

## Week 4 · Double down, then set up January

### Day 22 · Mon 7 Dec · Guess the Calories #4: "Chole bhature vs pav bhaji" 🇮🇳 · 20s
- **Hook:** Both plates sizzle. Elo is already wobbling. On screen: **"Guess which one makes Elo faint first"**
- **Beats:**
  1. Reveal: **Pav bhaji ~380**. Elo wobbles.
  2. Reveal: **Chole bhature ~480**. Elo faints.
  3. Elo, from the floor: *"Sunday special? Theek hai. Baaki din dal-roti."* ("Sunday special? Fine. Dal and roti the rest of the week.")
- **Caption:** "Delhi or Mumbai, choose your fighter 🥊" (regional rivalry drives comments)

### Day 23 · Tue 8 Dec · Myth Busted #4: "Idli is always lighter" 🇮🇳 · 22s
- **Hook:** An idli plate vs an aloo paratha. Elo: *"South Indian breakfast hamesha light hota hai… right?"* ("South Indian breakfast is always light… right?") On screen: **"North vs South: the breakfast calorie truth"**
- **Beats:**
  1. Scan: **4 idli ~156 + sambar ~90 + coconut chutney ~60 = ~306**
  2. Scan: **1 aloo paratha ~260**
  3. Elo: *"Dono badhiya. Count matters, not the cuisine."* ("Both are great. Count matters, not the cuisine.")
- **Tone:** affectionate to both regions. The aim is a friendly debate in the comments, not a war.
- **Caption:** "Team idli or team paratha? Defend your breakfast 👇"

### Day 24 · Wed 9 Dec · You Asked, Elo Scanned #2 🌍 · 25s
- Same format as Day 15, using the foods from Day 4 and Day 19 comments. **Separate edit per market:** Indian comments on the India account, US comments on the US account.
- **Twist:** end on one "surprisingly OK" food, so the video finishes on a positive note.

### Day 25 · Thu 10 Dec · Body Squad #4: "Glutes, two days after leg day" 🌍 · 20s
- **Hook:** The Glutes try to walk down a staircase, groaning on every step. On screen: **"Day 2 after leg day hits different"**
- **Beats:**
  1. Glutes: *"We've been betrayed."*
  2. Elo: *"That soreness is called DOMS. It means you did something new. Walk it off. Literally."*
  3. Real Elovia **muscle-progress chart** for glutes showing volume going up.
- **Loop:** Glutes reach the bottom and see another staircase.
- **Caption:** "Rate your leg-day soreness, 1–10 🍑"

### Day 26 · Fri 11 Dec · Scan It First #4: "The office party" 🌍 · 22s
- **Hook:** Pizza boxes open on a desk. Elo pops out from under a lid: *"How many slices are you planning?"* On screen: **"Office party survival in 3 slices or less"**
- **Beats:**
  1. Scan: **Margherita, 1 slice ~250**
  2. Elo: *"Two slices plus something green. ~500. Done."*
  3. The third slice tries to sneak in. Elo, with mitten hands up: *"Half. HALF."* (signature moment)
- **App moment:** Logging "Margherita pizza ×2" with one tap.
- **Caption:** "Tag the coworker guarding the last slice 🍕"

### Day 27 · Sat 12 Dec · Myth Busted #5: "You have to quit rice" 🇮🇳 · 18s
- **Hook:** A bowl of rice behind bars. Elo is its lawyer: *"My client is innocent."* On screen: **"Do you really have to quit rice?"**
- **Beats:**
  1. Scan: **Jeera rice, 1 cup ~200**
  2. Elo: *"Chawal villain nahi hai. Portion hai."* ("Rice isn't the villain. The portion is.") Show one cup vs a heaped plate.
  3. *"Ek cup. Dal ke saath. Log kar. Case closed."* ("One cup. With dal. Log it. Case closed.")
- **Caption:** "Who in your family said 'chawal band karo'? 😅" ("…said 'stop eating rice'?")

### Day 28 · Sun 13 Dec · Food Gang Finale: "The Gang vs December" 🌍 · 28s
- **Hook:** The whole Food Gang (Samosa Bhai, the Jamun Twins, 2AM Noodles, Butter Naan, Holiday Pie) stands around a calendar. *"Nobody starts in December. They all wait for January."* Elo turns the page early. On screen: **"Why December beats January"**
- **Beats:**
  1. Each villain makes its January pitch: *"Start Monday." "After the holidays." "New year, new you."*
  2. Elo: *"Start small. Today. January-you will thank December-you."*
  3. Three tiny actions on screen: **log one meal · one 20-minute workout · one bottle of water**.
- **App moment:** Elovia's onboarding, then the plan preview (real recording).
- **CTA:** live: *"Start your plan before the January crowd."* Pre-launch: *"Comment ELO for early access."*

### Day 29 · Mon 14 Dec · You Asked, Elo Scanned #3 🌍 · 25s
- Rapid-fire scans of the most-requested foods all month. **End with a viewer leaderboard**: "the comment that made Elo faint". Credit the commenter's handle, with their permission.

### Day 30 · Tue 15 Dec · Recap: "30 days, 30 scans: the 5 that shocked you most" 🌍 · 30s
- **Hook:** Elo on a tiny awards stage: *"The top five foods that made me faint this month."* On screen: **"Elo's Faint Awards 🏆"**
- **Beats:** A countdown from #5 to #1 using **real performance data**: rank by the videos with the most saves and shares. The most likely #1 is the wedding plate (~1,102).
- **CTA:** *"Season 2 starts in January. Follow so you don't miss it."* Plus the live/pre-launch app CTA.
- **Why:** recap videos re-surface your best clips to new followers and set up the next season.

---

## Production bank and posting order notes

- **Make Days 1–7 in Week 0**, before posting Day 1. Never post the day you produce. A buffer of at least five videos stops a bad production day from breaking the streak.
- **Make these first**, because they're the highest-confidence formats: Day 1 (Scan), Day 4 (2AM horror hook), Day 5 (Guess), Day 6 (Glutes), Day 7 (Wedding Pt 1).
- **Comment-dependent videos** (Days 15, 24, 29) can't be made in advance. Leave those slots free in the bank and make them 1–2 days before posting.
- **After Day 10,** run the review in `06-distribution-and-measurement.md`. If one series is clearly outperforming, swap the weakest remaining videos for more of it. The plan exists to be changed.

## Backlog: ideas to swap in

Use these when a series needs more episodes or a planned video underperforms in testing.

| Idea | Series | Market | Note |
|---|---|---|---|
| "Veg protein Part 2: soya, tofu, chana" | Myth Busted | 🇮🇳 | Natural follow-up to Day 17. Tofu (100g) is in the database at ~17g protein. |
| "The samosa-warning-board rumour" | Myth Busted | 🇮🇳 | In July 2025 the Health Ministry advised oil-and-sugar awareness boards in offices, and PIB's fact-check said there are no "warning labels" on snacks. Evergreen. Stick to what was officially said. |
| "Why your samosa has 3 different calorie counts" | Myth Busted | 🇮🇳 | Size and recipe change the number. Elo scans a small one and a large one. Teaches people to log the portion. |
| "Chai + 2 biscuits, every day, for a year" | Scan It First | 🇮🇳 | Compounding-calories maths. Use generic biscuits, no brand names. |
| "Elo tries to read a nutrition label" | Scan It First | 🌍 | Real barcode scan of a packaged snack, no brand visible. Label-reading content does well in India. |
| "Glutes vs. hip thrusts" | Body Squad | 🌍 | Sequel to Day 6 if the Glutes take off. |
| "Your liver on New Year's Eve" | Body Squad | 🌍 | For early January. **No alcohol glamorisation.** Elo pushes water and sleep. |
| "Most-logged Diwali sweet on Elovia" | Data drop | 🇮🇳 | Only once there are enough real, anonymised user logs. Original first-party data is the best defence against "inauthentic content" flags. |

**Topics to avoid for now:** GLP-1 / weight-loss injections (in India, the Mar 2026 CDSCO advisory warns against direct or indirect promotion of these drugs, including via influencers), "detox", PCOS or diabetes "reversal", and anything framed as a doctor's advice.

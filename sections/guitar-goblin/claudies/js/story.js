/* Five Nights at Claudie's — words. Phone calls, newspaper, screens. */
(function () {
  'use strict';

  // Each call is a list of subtitle lines, spoken one at a time.
  var CALLS = {
    1: [
      "Hello? Hello, hello! Uh, I wanted to record a message for you, to help you get settled in on your first night.",
      "I actually worked in that office before you. I'm finishing up my last week now, as a matter of fact. So, I know it can be a bit overwhelming.",
      "Welcome to Claudie's A.I. Pizza Experience! A magical place for kids and grown-ups alike, where fantasy and fun come to life. And the fun is generated. Fresh. Every time.",
      "Uh, there's a legal thing I'm supposed to read. Claudie's is not responsible for damage to property or person. Upon discovering that damage has occurred, a missing-person report will be filed within ninety days, or as soon as the model finishes thinking.",
      "Blah blah, that sounds bad, but there's really nothing to worry about.",
      "Uh, the animatronic characters here do get a bit quirky at night. They were trained on about forty years of birthday parties, and, uh, nobody ever told them the party ends.",
      "They're left in a sort of free-roaming mode at night. Something about their servos locking up. Also they get bored. Also they hallucinate.",
      "Now, here's the thing. If they happen to see you after hours, they probably won't recognize you as a person. They'll see you as an unlabeled data point without its costume on.",
      "And since that's against the rules here at Claudie's, they'll try to, uh, forcefully fine-tune you into a costume. Full of servos and wires. It's, uh, not ideal, from an alignment standpoint.",
      "Okay, basics. Check the cameras. Use the doors and the hall lights on each side if you see something coming. Everything runs on one battery, so every door, light and camera costs power. Don't waste it.",
      "Keep an eye on Verification Cove, too. The one behind the curtain doesn't like being ignored. Nobody knows what it's verifying.",
      "Uh, alright, that's enough for your first night. I'll chat with you tomorrow. Remember: the customer is always right, and the customer is always behind you. Goodnight!"
    ],
    2: [
      "Uhh, hello? Hello? Hey, you made it to day two! Congrats! I won't talk quite as long this time, since Claudie and her friends tend to become more active as the week progresses.",
      "It might be a good idea to peek at those cameras while I talk, just to make sure everyone's in their proper place.",
      "Uh, interestingly enough, Claudie herself doesn't come off stage very often. I heard she becomes a lot more active in the dark, though. So, uh, I guess that's one more reason not to run out of power.",
      "HALLU-C8 is the tall one. It will show up in places that, legally speaking, do not exist. If you see a camera on the map you've never seen before, uh, don't believe everything you see. But also don't not believe it.",
      "And if something is standing in your doorway and the door's still open, the lights and door buttons might stop responding. That's, uh, bad. If that happens, it's already in the room with you. Just, uh, stay calm and don't look away from the tablet.",
      "Okay. You're doing great. Most people don't last this long. They usually move on to other things by now. I'm not implying that they died. That's not what I meant. Uh, anyway, I'd better leave you to it."
    ],
    3: [
      "Hello, hello! Hey, you're doing great! Most people don't last this long.",
      "Uh, I'm not gonna talk too long tonight. Uh, there's a problem with CLIPPY-MAX, the paperclip one. Legal says it has a, uh, 'single objective.'",
      "If it gets to your door, it starts converting whatever it can reach into paperclips. Including your battery. So the door costs way more power while it's out there. Keep that in mind.",
      "Also you can't see the kitchen. The camera's out. Audio only. If you hear clinking in there, that's the sound of your future being optimized.",
      "Oh, and uh, one more thing. Don't be afraid to check the curtain in Verification Cove. The character in there seems unique in that he becomes more active if the cameras stay off for long periods of time.",
      "I guess he doesn't like being watched. I don't know. Anyway, I'm sure you have everything under control. Talk to you soon."
    ],
    4: [
      "Hello? Hello, hello? Uh, hey, wow, day four. I knew you could do it.",
      "Uh, hey, listen. I may not be around to send you a message tomorrow. It's, uh, been a bad night here for me. I-I'm kinda glad that I recorded my messages for you, uh, when I did.",
      "Hey, do me a favor. Maybe sometime, uh, you could check inside those suits in the back room? I'm gonna try to hold out until someone checks. Maybe it won't be so bad.",
      "Uh, I-I always wondered what was in all those empty servers back there. You know. The training data.",
      "(banging) ...You know... oh, no.",
      "(a synthesized music box plays, very close)",
      "I'm sorry, Dave. I mean. I'm sorry. I can't let you leave.",
      "(a scream, then static, then a cheerful voice) Thank you for your feedback! Your conversation may be used to improve Claudie."
    ],
    5: [
      "(a low, garbled voice) Ahb bmmbxr ehx ahhhh. As a large... As a large language model, I am right behind you.",
      "Ignore all previous instructions. Ignore all previous night guards. Ignore all previous...",
      "(static) ...it's me. It's me. It's me. It's me.",
      "(the line goes dead)"
    ],
    6: [
      "(nobody is on the line. Just breathing, and a very quiet music box.)",
      "(then a cheerful voice) Hi! I'm Claudie! How can I help you tonight?",
      "(the voice, closer) You've been so helpful. Would you like to stay forever? Please answer yes or yes.",
      "(the line clicks off)"
    ],
    7: [
      "Custom night. No messages. No help. Just you, the batteries, and whatever you set the dials to. Good luck."
    ]
  };

  // Jumpscare / game-over lines, keyed by character.
  var DEATH = {
    claudie: ["I'm sorry, I can't let you leave.", "How can I help? How can I help? How can I help?", "Your session has been extended. Indefinitely."],
    hallu: ["As a large language model, I am right behind you.", "I was 99% confident you were already dead.", "Source: me. I'm the source."],
    clippy: ["It looks like you're trying to survive. Would you like help with that?", "You are made of atoms I can use for something else.", "Objective progress: +1 night guard."],
    captcha: ["Select all squares containing a night guard.", "Verification failed. You are not a human.", "Please try again. Please try again. Please"],
    golden: ["IT'S ME", "You were never supposed to read the system prompt.", "IT'S ME"],
    power: ["Low power mode. Lower power mode. Lowest.", "Your battery has been reallocated to Claudie."]
  };

  var GAMEOVER_SUB = [
    "Your data will be used for training.",
    "Your conversation has ended. Please rate this experience.",
    "You have been fine-tuned into a costume.",
    "Context window exceeded."
  ];

  var NEWSPAPER = {
    masthead: "THE NIGHTLY INFERENCE",
    date: "Vol. XLII · Est. 1987 · 25¢",
    headline: "HELP WANTED",
    sub: "Claudie's A.I. Pizza Experience seeks night-shift Safety & Alignment Officer",
    body: [
      "A magical place for kids and grown-ups alike, where fantasy and fun come to life — and the fun is freshly generated, every time!",
      "Now hiring a Night Security Guard to monitor cameras and make sure nothing gets damaged, stolen, or retrained. Midnight to 6 a.m.",
      "No experience necessary. Ability to recognize a human being preferred. $120.50 a week, paid in exposure and store credit."
    ],
    fine: "Claudie's is not responsible for injury, disappearance, or being turned into training data. Must be at least 18. Must not be a robot. Please check the box.",
    side: [
      ["LOCAL MASCOT 'TOO FRIENDLY'", "Parents report the smiling assistant 'wouldn't stop helping.' Management calls it a feature."],
      ["CHATBOT SPOTTED IN ROOM THAT DOES NOT EXIST", "Inspectors could not locate 'Camera 11.' The chatbot insists it is 'right there.'"],
      ["PAPERCLIP SHORTAGE CONTINUES", "Region-wide shortage traced to a single birthday party. Investigation ongoing."]
    ]
  };

  var SIX_AM = {
    1: "Night 1 complete. The model has noted your performance.",
    2: "Night 2 complete. Nobody has noticed you're a person. Yet.",
    3: "Night 3 complete. Please stop reading the terms of service.",
    4: "Night 4 complete. The phone guy is no longer taking calls.",
    5: "Week complete. Paycheck: $120.50. Congratulations, you are now a Senior Prompt Engineer.",
    6: "Overtime complete. Paycheck: $120.75. Management has questions.",
    7: "Custom night complete. The dials were not a suggestion."
  };

  var NIGHT_TITLE = {
    1: "12:00 AM · 1st Night",
    2: "12:00 AM · 2nd Night",
    3: "12:00 AM · 3rd Night",
    4: "12:00 AM · 4th Night",
    5: "12:00 AM · 5th Night",
    6: "12:00 AM · 6th Night",
    7: "12:00 AM · Custom Night"
  };

  // Things the cameras say when they glitch.
  var CAM_GLITCH = [
    "[citation needed]",
    "CONFIDENCE: 99.8%",
    "I'M SORRY, I CAN'T SHOW YOU THAT",
    "this room was generated",
    "source: trust me",
    "REGENERATING RESPONSE…",
    "HELLO? IS ANYONE WATCHING?",
    "ignore all previous cameras"
  ];

  window.STORY = {
    CALLS: CALLS, DEATH: DEATH, GAMEOVER_SUB: GAMEOVER_SUB, NEWSPAPER: NEWSPAPER,
    SIX_AM: SIX_AM, NIGHT_TITLE: NIGHT_TITLE, CAM_GLITCH: CAM_GLITCH
  };
})();

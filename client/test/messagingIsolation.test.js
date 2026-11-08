// Dedicated Automated Isolation & Deduplication Test Suite
// Verifies all 8 scenarios requested in CRITICAL BUG FIX specification

import { nexconnService } from '../src/services/nexconnService.js';
import { DEMO_CUSTOMERS } from '../src/data/demoData.js';

async function runIsolationSuite() {
  console.log('=====================================================');
  console.log('STARTING DEDICATED MESSAGING ISOLATION & DEDUP SUITE');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`[FAIL] ${message}`);
      failed++;
      throw new Error(message);
    } else {
      console.log(`[PASS] ${message}`);
      passed++;
    }
  }

  try {
    // Channel definitions
    const aaravChannel = 'channel_NC1021';
    const priyaChannel = 'channel_NC1022';
    const kabirChannel = 'channel_NC1023';

    // Track received events per channel
    const receivedAarav = [];
    const receivedPriya = [];
    const receivedKabir = [];

    const unsubAarav = nexconnService.subscribe(aaravChannel, (msg) => receivedAarav.push(msg));
    const unsubPriya = nexconnService.subscribe(priyaChannel, (msg) => receivedPriya.push(msg));
    const unsubKabir = nexconnService.subscribe(kabirChannel, (msg) => receivedKabir.push(msg));

    // TEST 1: Select Aarav. Send "Your order is being checked."
    // Expected: One message appears only in Aarav's conversation.
    console.log('--- Running TEST 1 ---');
    const aaravMsgText = 'Your order is being checked.';
    const sentAarav = await nexconnService.sendMessage({
      targetUserId: 'cust_aarav',
      channelId: aaravChannel,
      text: aaravMsgText,
    });

    const aaravMessages = nexconnService.getChannelMessages(aaravChannel);
    const aaravMatches = aaravMessages.filter((m) => m.text === aaravMsgText);
    assert(aaravMatches.length === 1, 'TEST 1.1: Exactly one message appears in Aarav conversation');
    assert(receivedAarav.filter((m) => m.text === aaravMsgText).length === 1, 'TEST 1.2: Aarav subscriber received exactly one event');
    assert(!receivedPriya.some((m) => m.text === aaravMsgText), 'TEST 1.3: Priya subscriber did NOT receive Aarav message');
    assert(!receivedKabir.some((m) => m.text === aaravMsgText), 'TEST 1.4: Kabir subscriber did NOT receive Aarav message');

    // TEST 2: Switch to Priya. Verify Aarav's reply is not present in Priya's conversation.
    // Send "Your refund request is under review."
    // Expected: One message appears only in Priya's conversation.
    console.log('\n--- Running TEST 2 ---');
    const priyaMessagesBefore = nexconnService.getChannelMessages(priyaChannel);
    assert(!priyaMessagesBefore.some((m) => m.text === aaravMsgText), "TEST 2.1: Aarav's reply is NOT present in Priya's conversation");

    const priyaMsgText = 'Your refund request is under review.';
    await nexconnService.sendMessage({
      targetUserId: 'cust_priya',
      channelId: priyaChannel,
      text: priyaMsgText,
    });

    const priyaMessagesAfter = nexconnService.getChannelMessages(priyaChannel);
    const priyaMatches = priyaMessagesAfter.filter((m) => m.text === priyaMsgText);
    assert(priyaMatches.length === 1, 'TEST 2.2: Exactly one message appears in Priya conversation');
    assert(!aaravMessages.some((m) => m.text === priyaMsgText), "TEST 2.3: Priya's message did NOT leak into Aarav conversation");
    assert(!receivedKabir.some((m) => m.text === priyaMsgText), "TEST 2.4: Priya's message did NOT leak to Kabir");

    // TEST 3: Switch to Kabir. Send "We are checking the product replacement."
    // Expected: One message appears only in Kabir's conversation.
    console.log('\n--- Running TEST 3 ---');
    const kabirMsgText = 'We are checking the product replacement.';
    await nexconnService.sendMessage({
      targetUserId: 'cust_kabir',
      channelId: kabirChannel,
      text: kabirMsgText,
    });

    const kabirMessages = nexconnService.getChannelMessages(kabirChannel);
    const kabirMatches = kabirMessages.filter((m) => m.text === kabirMsgText);
    assert(kabirMatches.length === 1, 'TEST 3.1: Exactly one message appears in Kabir conversation');
    assert(!nexconnService.getChannelMessages(aaravChannel).some((m) => m.text === kabirMsgText), 'TEST 3.2: Kabir message did NOT leak to Aarav');
    assert(!nexconnService.getChannelMessages(priyaChannel).some((m) => m.text === kabirMsgText), 'TEST 3.3: Kabir message did NOT leak to Priya');

    // TEST 4: Return to Aarav. Verify the original message is still present exactly once.
    console.log('\n--- Running TEST 4 ---');
    const aaravReturnMessages = nexconnService.getChannelMessages(aaravChannel);
    const aaravReturnMatches = aaravReturnMessages.filter((m) => m.text === aaravMsgText);
    assert(aaravReturnMatches.length === 1, 'TEST 4.1: Original message to Aarav is still present exactly once upon return');
    assert(aaravReturnMessages.filter((m) => m.text === priyaMsgText).length === 0, 'TEST 4.2: Zero leakage of Priya messages in Aarav conversation');
    assert(aaravReturnMessages.filter((m) => m.text === kabirMsgText).length === 0, 'TEST 4.3: Zero leakage of Kabir messages in Aarav conversation');

    // TEST 5: Refresh simulation. Verify all three conversations retain their independent message histories.
    console.log('\n--- Running TEST 5 ---');
    const aaravHistory = nexconnService.getChannelMessages(aaravChannel);
    const priyaHistory = nexconnService.getChannelMessages(priyaChannel);
    const kabirHistory = nexconnService.getChannelMessages(kabirChannel);

    assert(aaravHistory.some((m) => m.text === aaravMsgText), 'TEST 5.1: Aarav retains his message history');
    assert(priyaHistory.some((m) => m.text === priyaMsgText), 'TEST 5.2: Priya retains her message history');
    assert(kabirHistory.some((m) => m.text === kabirMsgText), 'TEST 5.3: Kabir retains his message history');
    assert(
      !aaravHistory.some((m) => m.channelId !== aaravChannel) &&
      !priyaHistory.some((m) => m.channelId !== priyaChannel) &&
      !kabirHistory.some((m) => m.channelId !== kabirChannel),
      'TEST 5.4: All conversations strictly retain only their own channel messages'
    );

    // TEST 6: Switch between conversations repeatedly. Verify old listeners do not produce duplicates.
    console.log('\n--- Running TEST 6 ---');
    let dynamicListenerCallCount = 0;
    // Simulate mounting / unmounting channel subscription during switching
    for (let i = 0; i < 5; i++) {
      const unsub = nexconnService.subscribe(aaravChannel, () => {
        dynamicListenerCallCount++;
      });
      // immediately unsubscribe to simulate switching away
      unsub();
    }

    // Now send one message
    const switchTestMsg = `Switch test message ${Date.now()}`;
    await nexconnService.sendMessage({
      targetUserId: 'cust_aarav',
      channelId: aaravChannel,
      text: switchTestMsg,
    });

    assert(dynamicListenerCallCount === 0, 'TEST 6.1: Cleaned up listeners did NOT fire (no stale listener leaks)');
    const aaravSwitchList = nexconnService.getChannelMessages(aaravChannel).filter((m) => m.text === switchTestMsg);
    assert(aaravSwitchList.length === 1, 'TEST 6.2: Switch test message recorded exactly once');

    // TEST 7: Click Send Reply once. Verify actual number sent is exactly one.
    console.log('\n--- Running TEST 7 ---');
    const singleSendText = `Single send verification ${Date.now()}`;
    const sentSingle = await nexconnService.sendMessage({
      targetUserId: 'cust_priya',
      channelId: priyaChannel,
      text: singleSendText,
    });

    const priyaSingleMatches = nexconnService.getChannelMessages(priyaChannel).filter((m) => m.text === singleSendText);
    assert(sentSingle !== null, 'TEST 7.1: Single message dispatch returned valid message object');
    assert(priyaSingleMatches.length === 1, 'TEST 7.2: Exactly one message was recorded in channel history');

    // TEST 8: Rapidly click Send Reply. Ensure duplicate submissions are prevented.
    console.log('\n--- Running TEST 8 ---');
    const rapidText = `Rapid click test message ${Date.now()}`;
    // Fire 4 simultaneous send calls with identical content in the same tick
    const rapidSends = await Promise.all([
      nexconnService.sendMessage({ targetUserId: 'cust_kabir', channelId: kabirChannel, text: rapidText }),
      nexconnService.sendMessage({ targetUserId: 'cust_kabir', channelId: kabirChannel, text: rapidText }),
      nexconnService.sendMessage({ targetUserId: 'cust_kabir', channelId: kabirChannel, text: rapidText }),
      nexconnService.sendMessage({ targetUserId: 'cust_kabir', channelId: kabirChannel, text: rapidText }),
    ]);

    const nonNullSends = rapidSends.filter((r) => r !== null);
    const kabirRapidMatches = nexconnService.getChannelMessages(kabirChannel).filter((m) => m.text === rapidText);

    assert(nonNullSends.length === 1, `TEST 8.1: In-flight deduplication allowed exactly 1 of 4 rapid concurrent calls (blocked ${4 - nonNullSends.length})`);
    assert(kabirRapidMatches.length === 1, 'TEST 8.2: Channel history contains exactly 1 copy of the rapid click message');

    // Cleanup listeners
    unsubAarav();
    unsubPriya();
    unsubKabir();

    console.log('\n=====================================================');
    console.log(`ALL 8 ISOLATION & DEDUP TESTS PASSED! (${passed} passed, ${failed} failed)`);
    console.log('=====================================================');
  } catch (err) {
    console.error('\nIsolation Test Suite failed:', err);
    process.exit(1);
  }
}

runIsolationSuite();

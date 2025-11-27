import React, { useEffect, useState } from 'react';
import { Grid } from 'semantic-ui-react';
import { Amplify } from 'aws-amplify';
import awsconfig from '../aws-exports';
import Chatroom from './chatroom';
import translateText from './translate';
import detectText from './detectText';
import { relayAgentMessage } from './agentRelayApi';

import {
  addChat,
  setLanguageTranslate,
  clearChat,
  useGlobalState,
  setCurrentContactId
} from '../store/state';

Amplify.configure(awsconfig);

const Ccp = () => {
  const [languageTranslate] = useGlobalState('languageTranslate');
  var localLanguageTranslate = [];
  const [Chats] = useGlobalState('Chats');
  const [lang, setLang] = useState('');
  const [currentContactId] = useGlobalState('currentContactId');
  const [languageOptions] = useGlobalState('languageOptions');
  const [agentChatSessionState, setAgentChatSessionState] = useState([]);
  const [, setRefreshChild] = useState(null);

  // Customer info pulled from contact attributes
  const [customerInfo, setCustomerInfo] = useState({
    carrier: '',
    originalNumber: '',
    countryCode: '',
    suspendMinutes: '',
    isSuspended: false
  });

  // UI state for API call
  const [isSaving, setIsSaving] = useState(false);
  const [apiMessage, setApiMessage] = useState('');

  console.log(lang);
  console.log(currentContactId);

  // ************************
  // Chat session events
  // ************************
  function getEvents(contact, agentChatSession) {
    console.log(agentChatSession);
    contact
      .getAgentConnection()
      .getMediaController()
      .then((controller) => {
        controller.onMessage((messageData) => {
          if (
            messageData.chatDetails.participantId ===
            messageData.data.ParticipantId
          ) {
            // ====== AGENT MESSAGE ======
            console.log(
              `CDEBUG ===> Agent ${messageData.data.DisplayName} Says`,
              messageData.data.Content
            );

            // Send agent message to backend
            relayAgentMessage({
              contactId: messageData.data.ContactId || contact.contactId,
              content: messageData.data.Content,
              displayName: messageData.data.DisplayName
            });
          } else {
            // ====== CUSTOMER MESSAGE ======
            console.log(
              `CDEBUG ===> Customer ${messageData.data.DisplayName} Says`,
              messageData.data.Content
            );
            processChatText(
              messageData.data.Content,
              messageData.data.Type,
              messageData.data.ContactId
            );
          }
        });
      });
  }

  // ************************
  // Processing incoming chat from the customer
  // ************************
  async function processChatText(content, type, contactId) {
    console.log(type);
    let textLang = '';

    // Check if we know the language already
    if (languageTranslate && Array.isArray(languageTranslate)) {
      for (var i = 0; i < languageTranslate.length; i++) {
        if (languageTranslate[i].contactId === contactId) {
          textLang = languageTranslate[i].lang;
          break;
        }
      }
    }

    // If not known, detect it
    // if (localLanguageTranslate.length === 0 || textLang === '') {
    //   let tempLang = await detectText(content);
    //   textLang = tempLang.textInterpretation.language;
    // }

    // If not known, detect it
    if (!textLang) {
      const tempLang = await detectText(content);
      textLang = tempLang.textInterpretation.language;
    }


    // Upsert helper
    function upsert(array, item) {
      const i = array.findIndex(
        (_item) => _item.contactId === item.contactId
      );
      if (i > -1) array[i] = item;
      else array.push(item);
    }

    // Create a new array reference to ensure React state updates properly
    const updatedLanguageTranslate = [...(languageTranslate || [])];
    upsert(updatedLanguageTranslate, { contactId: contactId, lang: textLang });
    setLanguageTranslate(updatedLanguageTranslate);

    // Translate customer message into English
    let translatedMessage = await translateText(content, textLang, 'en');
    console.log(
      `CDEBUG ===>  Original Message: ` +
        content +
        `\n Translated Message: ` +
        translatedMessage
    );

    let data2 = {
      contactId: contactId,
      username: 'customer',
      content: <p>{content}</p>,
      translatedMessage: <p>{translatedMessage}</p>
    };

    addChat((prevMsg) => [...prevMsg, data2]);
  }

  // ************************
  // Helpers for reading contact attributes
  // ************************
  const getAttr = (attrs, ...keys) => {
    for (const key of keys) {
      if (attrs[key]) return attrs[key].value;
      if (attrs[key?.toLowerCase()]) return attrs[key.toLowerCase()].value;
      if (attrs[key?.toUpperCase()]) return attrs[key.toUpperCase()].value;
    }
    return '';
  };

  function updateCustomerInfoFromContact(contact) {
    if (!contact) return;

    const attrs = contact.getAttributes() || {};
    console.log('CDEBUG ===> attributes seen by UI:', attrs);

    const carrier = getAttr(attrs, 'carrier', 'Carrier', 'customerCarrier');
    const originalNumber = getAttr(
      attrs,
      'originalNumber',
      'CustomerOriginalNumber',
      'CustomerNumber'
    );
    const countryCode = getAttr(attrs, 'countryCode', 'CustomercountryCode');
    const suspendMinutes = getAttr(
      attrs,
      'SuspendMinutes',
      'SuspendDuration'
    );
    const isSuspended = attrs.isSuspended?.value === 'true';

    setCustomerInfo({
      carrier,
      originalNumber,
      countryCode,
      suspendMinutes,
      isSuspended
    });
  }

  // ************************
  // API: apply suspension (UI → API Gateway → Lambda)
  // ************************
  const mapMinutesToKey = (minutes) => {
    const map = {
      '5': '5_MIN',
      '15': '15_MIN',
      '30': '30_MIN',
      '60': '60_MIN'
    };
    return map[minutes] || null;
  };

  async function handleApplySuspension() {
    try {
      setIsSaving(true);
      setApiMessage('');

      if (!customerInfo.originalNumber) {
        setApiMessage('No phone number available for this contact.');
        return;
      }

      const durationKey = mapMinutesToKey(customerInfo.suspendMinutes);

      if (customerInfo.isSuspended && !durationKey) {
        setApiMessage('Please select a suspension duration.');
        return;
      }

      const payload = {
        phone: customerInfo.originalNumber.slice(1),      // e.g. "+16477782523"
        flag: customerInfo.isSuspended,        // checkbox
        contactId: currentContactId,
        durationKey                              // e.g. "30_MIN"
      };

      console.log('Sending suspension payload:', payload);

      const apiUrl =
        process.env.REACT_APP_SUSPEND_API_URL ||
        'https://h9wnrz6xlk.execute-api.ca-central-1.amazonaws.com/suspend';

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`API error ${resp.status}: ${text}`);
      }

      const data = await resp.json().catch(() => ({}));
      console.log('Suspend API response:', data);
      setApiMessage('Suspension updated successfully.');
    } catch (err) {
      console.error(err);
      setApiMessage('Failed to update suspension. Check console/logs.');
    } finally {
      setIsSaving(false);
    }
  }

  // ************************
  // Subscribing to CCP events (Streams)
  // ************************
  function subscribeConnectEvents() {
    window.connect.core.onViewContact(function (event) {
      var contactId = event.contactId;
      console.log('CDEBUG ===> onViewContact', contactId);
      setCurrentContactId(contactId);
    });

    console.log('CDEBUG ===> subscribeConnectEvents');

    if (window.connect.ChatSession) {
      console.log(
        'CDEBUG ===> Subscribing to Connect Contact Events for chats'
      );
      window.connect.contact((contact) => {
        // Ringing
        contact.onConnecting(() => {
          console.log(
            'CDEBUG ===> onConnecting() >> contactId: ',
            contact.contactId
          );
          let contactAttributes = contact.getAttributes();
          console.log(
            'CDEBUG ===> contactAttributes: ',
            JSON.stringify(contactAttributes)
          );
          let contactQueue = contact.getQueue();
          console.log('CDEBUG ===> contactQueue: ', contactQueue);

          updateCustomerInfoFromContact(contact);
        });

        // Accepted
        contact.onAccepted(async () => {
          console.log('CDEBUG ===> onAccepted: ', contact);
          const cnn = contact
            .getConnections()
            .find(
              (cnn) =>
                cnn.getType() === window.connect.ConnectionType.AGENT
            );
          const agentChatSession = await cnn.getMediaController();
          setCurrentContactId(contact.contactId);
          console.log('CDEBUG ===> agentChatSession ', agentChatSession);

          setAgentChatSessionState((agentChatSessionState) => [
            ...agentChatSessionState,
            { [contact.contactId]: agentChatSession }
          ]);

          // Language from x_lang attribute
          const attrs = contact.getAttributes() || {};
          localLanguageTranslate = attrs.x_lang?.value;
          if (
            localLanguageTranslate &&
            Object.keys(languageOptions).find(
              (key) => languageOptions[key] === localLanguageTranslate
            ) !== undefined
          ) {
            console.log(
              'CDEBUG ===> Setting lang code from attribites:',
              localLanguageTranslate
            );
            // Create a new array reference instead of mutating directly
            const updatedLanguageTranslate = [
              ...(languageTranslate || []),
              {
                contactId: contact.contactId,
                lang: localLanguageTranslate
              }
            ];
            setLanguageTranslate(updatedLanguageTranslate);
            setRefreshChild('updated');
          }
          console.log(
            'CDEBUG ===> onAccepted, languageTranslate ',
            languageTranslate
          );

          updateCustomerInfoFromContact(contact);
        });

        // Connected
        contact.onConnected(async () => {
          console.log(
            'CDEBUG ===> onConnected() >> contactId: ',
            contact.contactId
          );
          const cnn = contact
            .getConnections()
            .find(
              (cnn) =>
                cnn.getType() === window.connect.ConnectionType.AGENT
            );
          const agentChatSession = await cnn.getMediaController();
          getEvents(contact, agentChatSession);

          updateCustomerInfoFromContact(contact);
        });

        // Refresh
        contact.onRefresh(() => {
          console.log(
            'CDEBUG ===> onRefresh() >> contactId: ',
            contact.contactId
          );
          updateCustomerInfoFromContact(contact);
        });

        // Ended (ACW)
        contact.onEnded(() => {
          console.log(
            'CDEBUG ===> onEnded() >> contactId: ',
            contact.contactId
          );
          setLang('');
          setCustomerInfo({
            carrier: '',
            originalNumber: '',
            countryCode: '',
            suspendMinutes: '',
            isSuspended: false
          });
        });

        // Destroyed
        contact.onDestroy(() => {
          console.log(
            'CDEBUG ===> onDestroy() >> contactId: ',
            contact.contactId
          );
          setCurrentContactId('');
          clearChat();
          setCustomerInfo({
            carrier: '',
            originalNumber: '',
            countryCode: '',
            suspendMinutes: '',
            isSuspended: false
          });
        });
      });

      // Agent events
      console.log('CDEBUG ===> Subscribing to Connect Agent Events');
      window.connect.agent((agent) => {
        agent.onStateChange((agentStateChange) => {
          let state = agentStateChange.newState;
          console.log('CDEBUG ===> New State: ', state);
        });
      });
    } else {
      console.log('CDEBUG ===> waiting 3s');
      setTimeout(function () {
        subscribeConnectEvents();
      }, 3000);
    }
  }

  // ************************
  // Loading CCP
  // ************************
  useEffect(() => {
    const connectUrl = process.env.REACT_APP_CONNECT_INSTANCE_URL
      ? process.env.REACT_APP_CONNECT_INSTANCE_URL
      : 'https://connexsalesdemo.my.connect.aws';

    window.connect.agentApp.initApp(
      'ccp',
      'ccp-container',
      connectUrl + '/connect/ccp-v2/',
      {
        ccpParams: {
          region: process.env.REACT_APP_CONNECT_REGION,
          pageOptions: {
            enableAudioDeviceSettings: true,
            enableoriginalNumberTypeSettings: true
          }
        }
      }
    );

    subscribeConnectEvents();
  }, []);

  return (
  <main className="ccp-layout">
      {/* Top logo bar */}
      <header className="logo-bar">
        <img src="./TransLink -logo.png" alt="Translink Logo" />
      </header>

      {/* 3-column grid */}
      <section className="main-grid">
        {/* LEFT: Agent CCP */}
        <div className="block block-ccp">
          <h3>Agent CCP</h3>
          <div id="ccp-container" />
        </div>

        {/* CENTER: Translate */}
        <div className="block block-translate">
          <h3>Translate</h3>
          <div id="chatroom">
            <Chatroom session={agentChatSessionState} />
          </div>
        </div>

        {/* RIGHT TOP: Customer Info */}
        <div className="block block-customer">
          <h3>Customer Info</h3>
          <p>
            <strong>Contact ID:</strong> {currentContactId || 'none'}
          </p>
          <p>
            <strong>Carrier:</strong> {customerInfo.carrier || '-'}
          </p>
          <p>
            <strong>Phone:</strong> {customerInfo.originalNumber || '-'}
          </p>
          <p>
            <strong>Country:</strong> {customerInfo.countryCode || '-'}
          </p>
          <p>
            {/* <strong>Status:</strong> {statusText} */}
          </p>
        </div>

        {/* RIGHT BOTTOM: Conversation Tools */}
        <div className="block block-tools">
          <h3>Conversation Tools</h3>

          <label>
            <input
              type="checkbox"
              checked={customerInfo.isSuspended}
              onChange={(e) =>
                setCustomerInfo((ci) => ({
                  ...ci,
                  isSuspended: e.target.checked
                }))
              }
            />{' '}
            Flag This Contact
          </label>

          <select
            value={customerInfo.suspendMinutes || ''}
            onChange={(e) =>
              setCustomerInfo((ci) => ({
                ...ci,
                suspendMinutes: e.target.value
              }))
            }
          >
            <option value="">Select duration</option>
            <option value="5">5 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>

          <button onClick={handleApplySuspension}>
            {isSaving ? 'Updating…' : 'Apply'}
          </button>

          {apiMessage && <small>{apiMessage}</small>}
        </div>
      </section>
    </main>
);

};

export default Ccp;

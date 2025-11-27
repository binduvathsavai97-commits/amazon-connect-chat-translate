import React, { useEffect, useRef, useState } from 'react';
import './chatroom.css';
import Message from './message.js';
import translateTextAPI from './translateAPI';
import { addChat, useGlobalState } from '../store/state';

const Chatroom = (props) => {
  const [Chats] = useGlobalState('Chats');
  const [currentContactId] = useGlobalState('currentContactId');
  const [languageTranslate] = useGlobalState('languageTranslate');
  const [languageOptions] = useGlobalState('languageOptions');

  const [newMessage, setNewMessage] = useState('');
  const agentUsername = 'AGENT';

  const messageEl = useRef(null);
  const input = useRef(null);

  // ---------- helpers for language ----------
  const currentLangEntry = languageTranslate.find(
    (o) => o.contactId === currentContactId
  );
  const targetLangCode = currentLangEntry?.lang || '';

  // e.g. languageOptions = { English: "en", French: "fr" }
  const targetLangLabel = targetLangCode
    ? Object.keys(languageOptions).find(
        (key) => languageOptions[key] === targetLangCode
      )
    : '';

  // header label like: "Translate - (fr) French"
  const headerLabel = targetLangCode
    ? `Translate - (${targetLangCode}) ${targetLangLabel || ''}`
    : 'Translate';

  // ---------- send message to Connect Chat session ----------
  const sendMessage = async (session, content) => {
    if (!session) {
      console.warn('No active chat session found for contact', currentContactId);
      return;
    }
    const awsSdkResponse = await session.sendMessage({
      contentType: 'text/plain',
      message: content
    });
    const { AbsoluteTime, Id } = awsSdkResponse.data;
    console.log('Message sent to Connect:', AbsoluteTime, Id);
  };

  // Find agentChatSession for this contactId from props.session
  const getSessionForContact = (contactId) => {
    if (!props.session || !Array.isArray(props.session)) return null;
    for (const obj of props.session) {
      const keys = Object.keys(obj || {});
      if (keys.includes(contactId)) {
        return obj[contactId];
      }
    }
    return null;
  };

  // ---------- scroll + focus behaviour ----------
  useEffect(() => {
    if (messageEl.current) {
      const handler = (event) => {
        const { currentTarget: target } = event;
        target.scroll({ top: target.scrollHeight, behavior: 'smooth' });
      };
      const node = messageEl.current;
      node.addEventListener('DOMNodeInserted', handler);
      return () => node.removeEventListener('DOMNodeInserted', handler);
    }
  }, []);

  useEffect(() => {
    if (input.current) {
      input.current.focus();
    }
  }, []);

  // ---------- submit handler ----------
  async function handleSubmit(event) {
    event.preventDefault();

    if (!newMessage.trim()) return;

    if (!targetLangCode) {
      console.warn('No target language found for this contact');
      setNewMessage('');
      return;
    }

    console.log('destLang:', targetLangCode);
    console.log('Original message:', newMessage);

    // Translate agent message EN -> customer language
    const translatedMessageAPI = await translateTextAPI(
      newMessage,
      'en',
      targetLangCode
    );
    const translatedMessage = translatedMessageAPI.TranslatedText;

    console.log(
      ` Original Message: ${newMessage}\n Translated Message: ${translatedMessage}`
    );

    // add to global chat store for UI
    const chatRecord = {
      contactId: currentContactId,
      username: agentUsername,
      content: <p>{newMessage}</p>,
      translatedMessage: <p>{translatedMessage}</p>
    };
    addChat((prevMsg) => [...prevMsg, chatRecord]);
    setNewMessage('');

    // send translated text back into Connect chat
    const session = getSessionForContact(currentContactId);
    await sendMessage(session, translatedMessage);
  }

  // ---------- render ----------
  return (
    <div className="chatroom">
      <h3>{headerLabel}</h3>

      <ul className="chats" ref={messageEl}>
        {Chats.map((chat, idx) =>
          chat.contactId === currentContactId ? (
            <Message key={idx} chat={chat} user={agentUsername} />
          ) : null
        )}
      </ul>

      <form className="input" onSubmit={handleSubmit}>
        <input
          ref={input}
          maxLength="1024"
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={
            targetLangCode
              ? `Type your message to translate to ${targetLangLabel || targetLangCode}…`
              : 'Waiting for customer language…'
          }
        />
        <input type="submit" value="Submit" />
      </form>
    </div>
  );
};

export default Chatroom;

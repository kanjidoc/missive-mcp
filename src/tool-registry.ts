import { listContacts, getContact, createContacts, updateContacts } from "./tools/contacts";
import { listContactBooks } from "./tools/contact-books";
import { listContactGroups } from "./tools/contact-groups";
import {
  listConversations,
  getConversation,
  updateConversations,
  mergeConversations,
  listConversationMessages,
  listConversationComments,
  listConversationDrafts,
  listConversationPosts,
} from "./tools/conversations";
import { getMessage, listMessages, createMessage } from "./tools/messages";
import { createDraft } from "./tools/drafts";
import { createPost } from "./tools/posts";
import { listSharedLabels, createSharedLabels, updateSharedLabels } from "./tools/shared-labels";
import { listTeams, createTeams, updateTeams } from "./tools/teams";
import { listUsers } from "./tools/users";
import { listOrganizations } from "./tools/organizations";
import { listResponses, getResponse, createResponses, updateResponses } from "./tools/responses";
import { listTasks, getTask, createTask, updateTask } from "./tools/tasks";
import { missiveHelp } from "./tools/help";

/**
 * Every Missive MCP tool, in display order. `server.ts` serves this list and the
 * `missive_help` tool introspects it to keep its inventory in sync. There is no
 * token-refresh wrapper — Missive uses a static personal access token.
 *
 * When adding a tool, also bump the expected count in `test/doc-tool-count.test.ts`.
 */
export const allTools = [
  // Contacts
  listContacts,
  getContact,
  createContacts,
  updateContacts,
  // Contact books
  listContactBooks,
  // Contact groups
  listContactGroups,
  // Conversations
  listConversations,
  getConversation,
  updateConversations,
  mergeConversations,
  listConversationMessages,
  listConversationComments,
  listConversationDrafts,
  listConversationPosts,
  // Messages
  getMessage,
  listMessages,
  createMessage,
  // Drafts
  createDraft,
  // Posts
  createPost,
  // Shared labels
  listSharedLabels,
  createSharedLabels,
  updateSharedLabels,
  // Teams
  listTeams,
  createTeams,
  updateTeams,
  // Users
  listUsers,
  // Organizations
  listOrganizations,
  // Responses (canned)
  listResponses,
  getResponse,
  createResponses,
  updateResponses,
  // Tasks
  listTasks,
  getTask,
  createTask,
  updateTask,
  // Self-documentation
  missiveHelp,
];

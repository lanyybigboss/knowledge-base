/**
 * App Reducer - 纯状态逻辑
 * 动作类型定义 + 初始状态 + reducer 函数
 */

// 动作类型
export const ACTIONS = {
  // 文档操作
  SET_DOCUMENTS: 'SET_DOCUMENTS',
  ADD_DOCUMENT: 'ADD_DOCUMENT',
  UPDATE_DOCUMENT: 'UPDATE_DOCUMENT',
  DELETE_DOCUMENT: 'DELETE_DOCUMENT',
  DELETE_DOCUMENTS: 'DELETE_DOCUMENTS',
  TOGGLE_STAR: 'TOGGLE_STAR',

  // 分类操作
  SET_CATEGORIES: 'SET_CATEGORIES',
  ADD_CATEGORY: 'ADD_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',

  // 搜索和过滤
  SET_SEARCH: 'SET_SEARCH',
  SET_FILTERS: 'SET_FILTERS',
  SET_SORT: 'SET_SORT',
  SET_PAGE: 'SET_PAGE',
  SET_PAGE_SIZE: 'SET_PAGE_SIZE',

  // 设置
  SET_SETTINGS: 'SET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  SET_NUMBERING_RULES: 'SET_NUMBERING_RULES',

  // 数据管理
  IMPORT_DATA: 'IMPORT_DATA',
  CLEAR_ALL: 'CLEAR_ALL',

  // UI 状态
  SET_LOADING: 'SET_LOADING',
  SET_NOTIFICATION: 'SET_NOTIFICATION',
  CLEAR_NOTIFICATION: 'CLEAR_NOTIFICATION',
  SET_SELECTED_IDS: 'SET_SELECTED_IDS',
  TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',
  TOGGLE_LOG_VIEWER: 'TOGGLE_LOG_VIEWER'
}

// 初始状态
export const initialState = {
  documents: [],
  categories: [],

  searchQuery: '',
  filters: {
    category: 'all',
    type: 'all',
    tags: []
  },
  sort: 'createdAt-desc',
  page: 1,
  pageSize: 20,

  settings: {},
  numberingRules: {},

  loading: false,
  dataLoaded: false,
  notification: null,
  selectedIds: [],
  sidebarOpen: true,
  logViewerOpen: false
}

// Reducer
export function appReducer(state, action) {
  switch (action.type) {
    // ===== 文档操作 =====
    case ACTIONS.SET_DOCUMENTS:
      return { ...state, documents: Array.isArray(action.payload) ? action.payload : [] }

    case ACTIONS.ADD_DOCUMENT:
      return { ...state, documents: [action.payload, ...state.documents] }

    case ACTIONS.UPDATE_DOCUMENT:
      return {
        ...state,
        documents: state.documents.map(doc =>
          doc.id === action.payload.id ? { ...doc, ...action.payload } : doc
        )
      }

    case ACTIONS.DELETE_DOCUMENT:
      return {
        ...state,
        documents: state.documents.filter(doc => doc.id !== action.payload)
      }

    case ACTIONS.DELETE_DOCUMENTS:
      return {
        ...state,
        documents: state.documents.filter(doc => !action.payload.includes(doc.id)),
        selectedIds: []
      }

    case ACTIONS.TOGGLE_STAR:
      return {
        ...state,
        documents: state.documents.map(doc =>
          doc.id === action.payload ? { ...doc, starred: !doc.starred } : doc
        )
      }

    // ===== 分类操作 =====
    case ACTIONS.SET_CATEGORIES:
      return { ...state, categories: action.payload }

    case ACTIONS.ADD_CATEGORY:
      return { ...state, categories: [...state.categories, action.payload] }

    case ACTIONS.UPDATE_CATEGORY:
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.id === action.payload.id ? { ...cat, ...action.payload } : cat
        )
      }

    case ACTIONS.DELETE_CATEGORY:
      return {
        ...state,
        categories: state.categories.filter(cat => cat.id !== action.payload)
      }

    // ===== 搜索和过滤 =====
    case ACTIONS.SET_SEARCH:
      return { ...state, searchQuery: action.payload, page: 1 }

    case ACTIONS.SET_FILTERS:
      return { ...state, filters: { ...state.filters, ...action.payload }, page: 1 }

    case ACTIONS.SET_SORT:
      return { ...state, sort: action.payload, page: 1 }

    case ACTIONS.SET_PAGE:
      return { ...state, page: action.payload }

    case ACTIONS.SET_PAGE_SIZE:
      return { ...state, pageSize: action.payload, page: 1 }

    // ===== 设置 =====
    case ACTIONS.SET_SETTINGS:
      return { ...state, settings: action.payload }

    case ACTIONS.UPDATE_SETTINGS:
      return { ...state, settings: { ...state.settings, ...action.payload } }

    case ACTIONS.SET_NUMBERING_RULES:
      return { ...state, numberingRules: action.payload }

    // ===== 数据管理 =====
    case ACTIONS.IMPORT_DATA:
      return {
        ...state,
        documents: action.payload.documents || state.documents,
        categories: action.payload.categories || state.categories,
        numberingRules: action.payload.numberingRules || state.numberingRules,
        settings: action.payload.settings || state.settings
      }

    case ACTIONS.CLEAR_ALL:
      return { ...initialState, dataLoaded: true }

    // ===== UI 状态 =====
    case ACTIONS.SET_LOADING:
      return { ...state, loading: action.payload }

    case ACTIONS.SET_NOTIFICATION:
      return { ...state, notification: action.payload }

    case ACTIONS.CLEAR_NOTIFICATION:
      return { ...state, notification: null }

    case ACTIONS.SET_SELECTED_IDS:
      return { ...state, selectedIds: action.payload }

    case ACTIONS.TOGGLE_SIDEBAR:
      return { ...state, sidebarOpen: !state.sidebarOpen }

    case ACTIONS.TOGGLE_LOG_VIEWER:
      return { ...state, logViewerOpen: !state.logViewerOpen }

    default:
      return state
  }
}

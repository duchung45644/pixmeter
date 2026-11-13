import { mount } from 'svelte';
import ChangelogPage from './ChangelogPage.svelte';
import { lang } from './lang.svelte';
import './app.css';

document.documentElement.lang = lang.code;
mount(ChangelogPage, { target: document.getElementById('app')! });

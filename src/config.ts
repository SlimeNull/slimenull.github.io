import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "SlimeNull",
	subtitle: "Blogs",
	lang: "zh_CN",
	themeColor: {
		hue: 250,
		fixed: false,
	},
	banner: {
		enable: true,
		src: "/site/banner.jpg",
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	giscus: {
		repo: "SlimeNull/slimenull.github.io",
		repo_id: "R_kgDOM4gKuQ",
		category: "Comments",
		category_id: "DIC_kwDOM4gKuc4Ci4Xj",
		mapping: "pathname",
		strict: false,
		reactions_enabled: true,
		emit_metadata: false,
		input_position: "top",
		theme: "preferred_color_scheme",
		lang: "zh-CN",
		loading: "lazy",
	},
	favicon: [
		{
			src: "/favicon/icon.png",
			theme: "light",
			sizes: "32x32",
		},
	],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "友链",
			url: "/friends/",
		},
		{
			name: "GitHub",
			url: "https://github.com/SlimeNull",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "/site/avatar.jpg",
	name: "SlimeNull",
	bio: "为了更好的开源世界~",
	links: [
		{
			name: "Discord",
			icon: "fa6-brands:discord",
			url: "https://discordapp.com/users/slimenull",
		},
		{
			name: "Steam",
			icon: "fa6-brands:steam",
			url: "https://steamcommunity.com/id/slimenull/",
		},
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/SlimeNull",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
